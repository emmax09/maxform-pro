import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Filter,
  FormInput,
  Inbox,
  Laptop,
  Link2,
  LayoutTemplate,
  ListFilter,
  Loader2,
  Mail,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Tag,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { FormBuilder } from "@/components/forms/FormBuilder";
import { SharedEmailTemplates } from "@/components/email/SharedEmailTemplates";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { CardGrid, PaginatedCardGrid } from "@/components/shared/CardGrid";
import { ConfirmationSettingsEditor } from "@/components/forms/ConfirmationSettingsEditor";
import { FormListConnector } from "@/components/contacts/FormListConnector";
import { FormRenderer } from "@/components/forms/FormRenderer";
import {
  TableFilterBar,
  TableFilterSelect,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
} from "@/components/shared/TableFilters";
import type {
  PaymentProduct,
  PaymentProviderConnection,
} from "@/components/payments/payment-types";
import { AutomationWorkspace } from "@/components/forms/AutomationWorkspace";
import {
  generateFormFromPrompt,
  type GeneratedFormDraft,
} from "@/components/forms/ai-form-generator";
import { cloneTemplateFields } from "@/components/forms/form-templates";
import {
  createId,
  defaultFormSettings,
  type FormField,
  type FormRecord,
  type FormSubmission,
  type FormsTab,
  type FormVersion,
  type FormWorkflow,
  type FormPayment,
  type FormTemplate,
} from "@/components/forms/form-types";
import { FORM_TAB_ORDER } from "@/components/forms/form-navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { downloadCsvFile } from "@/lib/csv";
import { useTableSelection } from "@/hooks/use-table-selection";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspaceRegion } from "@/contexts/WorkspaceRegionContext";
import {
  DEFAULT_WORKSPACE_ACCENT,
  LEGACY_FORM_ACCENTS,
  inferAccentColorMode,
  workspaceAccentColor,
} from "@/lib/workspace-branding";
import { normalizeBrandColor, readBrandColor } from "@/lib/brand-color";
import { scrollDashboardToTop } from "@/lib/dashboard-scroll";
import {
  activeFormEditorKey,
  clearFormDraft,
  restoreFormDraft,
  storeFormDraft,
} from "@/lib/form-draft-store";
import {
  getCachedServerState,
  persistentCacheKey,
  setCachedServerState,
} from "@/lib/performance/indexed-cache";
import {
  queryKeys,
  SERVER_STATE_STALE_TIME,
} from "@/lib/performance/query-client";
import {
  DASHBOARD_LIVE_SYNC_EVENT,
  type DashboardLiveSyncDetail,
} from "@/lib/performance/dashboard-live-sync";
import { formatCurrency } from "@/lib/regional-options";
import {
  listPaymentProducts,
  listPaymentProviderConnections,
  syncFormPaymentProduct,
} from "@/lib/payments";
import {
  createFormFromTemplate,
  createWorkspaceForm,
  deleteFormSubmissions,
  deleteWorkspaceForm,
  defaultFormModulePreferences,
  getFormModulePreferences,
  isFormSlugAvailable,
  loadFormModuleBootstrap,
  loadPersistedFormTemplates,
  loadWorkspaceFormAnalytics,
  listFormPayments,
  listFormSubmissions,
  listFormWorkflows,
  listWorkspaceForms,
  normalizeFormSlug,
  saveFormModulePreferences,
  saveWorkspaceForm,
  updateFormSubmission,
  type FormModulePreferences,
  type WorkspaceFormAnalytics,
} from "@/lib/forms";
import { cn } from "@/lib/utils";

export type { FormsTab } from "@/components/forms/form-types";

export type FormDraftGuard = {
  requiresUpdate: boolean;
  hasUnsavedChanges: boolean;
  saveDraft: () => Promise<boolean>;
  saveChanges: () => Promise<boolean>;
  discardChanges: () => Promise<boolean>;
};

type SlugStatus =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "invalid"
  | "error";

type FormsModuleProps = {
  activeTab: FormsTab;
  fullName: string;
  onDraftGuardChange?: (guard: FormDraftGuard | null) => void;
  userId?: string;
  onTabChange: (tab: FormsTab) => void;
  /**
   * Renders this module inside a project: the list is filtered to that
   * project, anything created here is filed there, and the module's own
   * title and tab strip give way to the project's. It is the same module and
   * the same builder either way -- only the lens changes.
   */
  projectId?: string | null;
  embedded?: boolean;
};

const tabDefinitions: Record<
  FormsTab,
  { label: string; icon: typeof FileText }
> = {
  analytics: { label: "Analytics", icon: BarChart3 },
  all: { label: "All forms", icon: FileText },
  templates: { label: "Templates", icon: LayoutTemplate },
  email_templates: { label: "Email templates", icon: Mail },
  ai: { label: "Max Builder", icon: Bot },
  responses: { label: "Responses", icon: Inbox },
  automations: { label: "Automations", icon: Workflow },
  settings: { label: "Settings", icon: Settings },
};

const tabs = FORM_TAB_ORDER.map((key) => ({
  key,
  ...tabDefinitions[key],
}));

const templateImages: Record<string, string> = {
  "Lead & feedback": "/images/form-templates/lead-feedback.webp",
  "People & hiring": "/images/form-templates/people-hiring.webp",
  Commerce: "/images/form-templates/commerce.webp",
  "Events & ticketing": "/images/form-templates/events-ticketing.webp",
  Scheduling: "/images/form-templates/scheduling.webp",
  Operations: "/images/form-templates/operations.webp",
};

const modulePreferencesKey = (userId: string) =>
  `maxform-form-module-settings:${userId}`;

const selectedFormKey = (userId: string) =>
  `maxform:selected-form:${userId}`;

const formsBootstrapCacheKey = (userId: string) =>
  `maxform:forms-bootstrap-v3:${userId}`;

const formsPersistentBootstrapKey = (userId: string) =>
  persistentCacheKey("forms", "bootstrap-v3", userId);

type FormsBootstrapCache = {
  forms: FormRecord[];
  hydrated: boolean;
  paymentProducts?: PaymentProduct[];
  paymentProviderConnections?: PaymentProviderConnection[];
  preferences: FormModulePreferences;
  templates: FormTemplate[];
};

const readFormsBootstrapCache = (
  userId: string | undefined,
): FormsBootstrapCache | null => {
  if (!userId) return null;
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(formsBootstrapCacheKey(userId)) || "null",
    ) as FormsBootstrapCache | null;
    if (
      !parsed ||
      !Array.isArray(parsed.forms) ||
      !Array.isArray(parsed.templates) ||
      typeof parsed.hydrated !== "boolean" ||
      !parsed.preferences
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeFormsBootstrapCache = (
  userId: string,
  cache: FormsBootstrapCache,
) => {
  try {
    sessionStorage.setItem(formsBootstrapCacheKey(userId), JSON.stringify(cache));
  } catch {
    // Large uploaded assets may exceed browser storage; live data still wins.
  }
};

const readLegacyModulePreferences = (userId: string) => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(modulePreferencesKey(userId)) || "{}",
    ) as Partial<FormModulePreferences>;
    if (Object.keys(parsed).length === 0) return null;
    return {
      ...defaultFormModulePreferences,
      ...parsed,
      accentColor: normalizeBrandColor(
        parsed.accentColor || defaultFormModulePreferences.accentColor,
      ),
      accessMode:
        parsed.accessMode === "authenticated" ? "authenticated" : "public",
      confirmation: {
        ...defaultFormModulePreferences.confirmation,
        ...(parsed.confirmation || {}),
        message:
          parsed.confirmation?.message ||
          parsed.confirmationMessage ||
          defaultFormModulePreferences.confirmation.message,
        useModuleDefault: false,
      },
    } satisfies FormModulePreferences;
  } catch {
    return null;
  }
};

const settingsFromModulePreferences = (
  preferences: FormModulePreferences,
  currency: string,
  workspaceAccent: string = DEFAULT_WORKSPACE_ACCENT,
) => {
  const settings = defaultFormSettings();
  const effectiveWorkspaceAccent = workspaceAccentColor(workspaceAccent);
  settings.payment.currency = currency;
  settings.access.mode = preferences.accessMode;
  settings.confirmation = {
    ...preferences.confirmation,
    useModuleDefault: true,
  };
  settings.notifications = {
    enabled: preferences.notificationsEnabled,
    recipients: preferences.notificationRecipients.trim(),
  };
  settings.theme = {
    ...settings.theme,
    accentColor:
      preferences.accentColorMode === "workspace"
        ? effectiveWorkspaceAccent
        : normalizeBrandColor(preferences.accentColor),
    accentColorMode:
      preferences.accentColorMode ||
      inferAccentColorMode(
        preferences.accentColor,
        effectiveWorkspaceAccent,
        LEGACY_FORM_ACCENTS,
      ),
    fontFamily: preferences.fontFamily,
    respondentMode: preferences.respondentMode,
  };
  return settings;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const cloneFieldsWithLogic = (form: FormRecord) => {
  const idMap = new Map<string, string>();
  const fields = form.fields.map((field) => {
    const id = createId("field");
    idMap.set(field.id, id);
    return {
      ...field,
      id,
      options: field.options ? [...field.options] : undefined,
      validation: field.validation ? { ...field.validation } : undefined,
      config: field.config
        ? {
            ...field.config,
            optionImages: field.config.optionImages
              ? { ...field.config.optionImages }
              : undefined,
            optionPrices: field.config.optionPrices
              ? { ...field.config.optionPrices }
              : undefined,
          }
        : undefined,
    };
  });
  const logic = form.settings.logic
    .filter(
      (rule) =>
        idMap.has(rule.sourceFieldId) && idMap.has(rule.targetFieldId),
    )
    .map((rule) => ({
      ...rule,
      id: createId("logic"),
      sourceFieldId: idMap.get(rule.sourceFieldId)!,
      targetFieldId: idMap.get(rule.targetFieldId)!,
    }));
  return { fields, logic };
};

const formState = (form: FormRecord) => {
  if (form.status === "archived") return "Archived";
  if (form.status === "draft") return "Draft";
  if (form.settings.lifecycle === "paused") return "Paused";
  if (form.settings.hasUnpublishedChanges) return "Unpublished changes";
  return "Published";
};

const formStateClasses = (state: string) => {
  if (state === "Published")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (state === "Paused")
    return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  if (state === "Unpublished changes")
    return "bg-blue-500/10 text-blue-700 dark:text-blue-400";
  return "bg-muted text-muted-foreground";
};

const answerText = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const answer = asRecord(item);
          return typeof answer.fileName === "string"
            ? answer.fileName
            : JSON.stringify(item);
        }
        return String(item);
      })
      .join(", ");
  }
  if (value == null || value === "") return "-";
  if (typeof value === "object") {
    const answer = asRecord(value);
    if (answer.kind === "file") {
      return typeof answer.fileName === "string"
        ? answer.fileName
        : "File attached";
    }
    if (answer.kind === "signature") return "Signature captured";
    return Object.entries(answer)
      .filter(([, part]) => part != null && part !== "")
      .map(([key, part]) => `${key.replace(/([A-Z])/g, " $1")}: ${String(part)}`)
      .join(" · ");
  }
  return String(value);
};

const responseImage = (value: unknown) => {
  const answer = asRecord(value);
  const source =
    typeof answer.url === "string"
      ? answer.url
      : typeof answer.dataUrl === "string"
        ? answer.dataUrl
        : "";
  const mimeType = typeof answer.mimeType === "string" ? answer.mimeType : "";
  const isSignature = answer.kind === "signature";
  if (
    !/^(https:\/\/|data:image\/)/i.test(source) ||
    (!isSignature && !mimeType.startsWith("image/"))
  ) {
    return null;
  }
  return {
    source,
    isSignature,
    label:
      typeof answer.fileName === "string" && answer.fileName
        ? answer.fileName
        : isSignature
          ? "Signature"
          : "Image upload",
  };
};

function ResponseAnswer({
  compact = false,
  value,
}: {
  compact?: boolean;
  value: unknown;
}) {
  if (Array.isArray(value) && value.some((item) => asRecord(item).kind === "file")) {
    return (
      <span className="flex min-w-0 flex-col gap-1.5">
        {value.map((item, index) => {
          const answer = asRecord(item);
          const label =
            typeof answer.fileName === "string" ? answer.fileName : `File ${index + 1}`;
          return typeof answer.url === "string" ? (
            <a
              key={`${label}-${index}`}
              href={answer.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-primary underline-offset-4 hover:underline"
            >
              {label}
            </a>
          ) : (
            <span key={`${label}-${index}`} className="truncate">{label}</span>
          );
        })}
      </span>
    );
  }
  const image = responseImage(value);
  if (!image) {
    const answer = asRecord(value);
    if (answer.kind === "file" && typeof answer.url === "string") {
      return (
        <a
          href={answer.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          {typeof answer.fileName === "string" ? answer.fileName : "Download file"}
        </a>
      );
    }
    return <>{answerText(value)}</>;
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-2", !compact && "items-start")}>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-white",
          compact ? "h-9 w-14" : "h-auto min-h-16 w-full max-w-[300px] p-2",
        )}
      >
        <img
          src={image.source}
          alt={image.isSignature ? "Submitted signature" : image.label}
          className={cn(
            "block max-h-[220px] max-w-full",
            image.isSignature ? "object-contain" : "h-full w-full object-cover",
          )}
        />
      </span>
      {compact && <span className="min-w-0 truncate">{image.label}</span>}
    </span>
  );
}

const getSubmissionMeta = (submission: FormSubmission) =>
  asRecord(submission.data._meta);

const getSubmissionStatus = (submission: FormSubmission) =>
  getSubmissionMeta(submission).status === "partial" ? "partial" : "completed";

const detectDevice = (userAgent: string | null) => {
  const value = userAgent || "";
  if (/mobile|iphone|android/i.test(value)) return "Mobile";
  if (/tablet|ipad/i.test(value)) return "Tablet";
  return "Desktop";
};

function EmptyState({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: typeof FileText;
  title: string;
}) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center border-y border-border px-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-[380px] text-[12px] leading-5 text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function FormSelector({
  forms,
  selectedFormId,
  setSelectedFormId,
}: {
  forms: FormRecord[];
  selectedFormId: string | null;
  setSelectedFormId: (formId: string) => void;
}) {
  const availableForms = forms.filter((form) => form.status !== "archived");
  if (availableForms.length === 0) return null;
  return (
    <Select
      value={selectedFormId || availableForms[0].id}
      onValueChange={setSelectedFormId}
    >
      <SelectTrigger className="w-full sm:w-[260px]">
        <SelectValue placeholder="Select a form" />
      </SelectTrigger>
      <SelectContent>
        {availableForms.map((form) => (
          <SelectItem key={form.id} value={form.id}>
            {form.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TemplateGallery({
  creatingTemplateId,
  loading,
  onCreate,
  templates,
}: {
  creatingTemplateId: string | null;
  loading: boolean;
  onCreate: (templateId: string) => void;
  templates: FormTemplate[];
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const groups = Array.from(
    new Set(templates.map((template) => template.group)),
  );
  return (
    <div className="pb-12">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-[22px] font-semibold">Start with a proven layout</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Every template is a fully editable starting point.
          </p>
        </div>
        <div className="relative w-full sm:w-[300px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search templates"
            className="pl-10"
          />
        </div>
      </div>

      <div className="mt-8 space-y-10">
        {loading && templates.length === 0 && (
          <CardGrid>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="aspect-[3/2] rounded-md" />
            ))}
          </CardGrid>
        )}
        {groups.map((group) => {
          const groupTemplates = templates.filter(
            (template) =>
              template.group === group &&
              (!normalizedQuery ||
                `${template.name} ${template.description}`
                  .toLowerCase()
                  .includes(normalizedQuery)),
          );
          if (groupTemplates.length === 0) return null;
          return (
            <section key={group}>
              <h3 className="text-[12px] font-semibold uppercase text-muted-foreground">
                {group}
              </h3>
              <PaginatedCardGrid
                items={groupTemplates}
                pageSize={12}
                itemLabel={`${group.toLowerCase()} templates`}
                getKey={(template) => template.id}
                resetKey={normalizedQuery}
                renderItem={(template) => (
                  <div
                    className="group flex min-h-[310px] flex-col overflow-hidden rounded-md border border-border bg-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-muted-foreground/50"
                  >
                    <div className="relative aspect-[3/2] overflow-hidden border-b border-border bg-muted">
                      <img
                        src={
                          template.imageUrl ||
                          templateImages[template.group]
                        }
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
                      />
                      {template.payment?.enabled && (
                        <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded bg-background/90 px-2 py-1 text-[9px] font-semibold uppercase text-emerald-700 shadow-sm backdrop-blur-sm dark:text-emerald-400">
                          <CircleDollarSign className="h-3 w-3" />
                          Payment
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <span className="text-[9px] font-semibold uppercase text-primary">
                        {template.group}
                      </span>
                      <h4 className="mt-2 text-[15px] font-semibold">
                        {template.name}
                      </h4>
                      <p className="mt-1 flex-1 text-[11px] leading-5 text-muted-foreground">
                        {template.description}
                      </p>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="text-[10px] text-muted-foreground">
                          {template.fields.length} fields
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => onCreate(template.id)}
                          disabled={creatingTemplateId !== null}
                        >
                          {creatingTemplateId === template.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowRight className="h-4 w-4" />
                          )}
                          Use template
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              />
            </section>
          );
        })}
        {!loading &&
          templates.length > 0 &&
          templates.every(
          (template) =>
            normalizedQuery &&
            !`${template.name} ${template.description}`
              .toLowerCase()
              .includes(normalizedQuery),
          ) && (
          <EmptyState
            icon={Search}
            title="No templates found"
            description="Try a broader search term."
          />
        )}
      </div>
    </div>
  );
}

function AllFormsView({
  forms,
  loading,
  onArchive,
  onCopyLink,
  onDelete,
  onDuplicate,
  onEdit,
  onEditUrl,
  onLifecycle,
  onNew,
  onOpenLive,
  onProjectAssigned,
  projectAssignmentsLoading,
  onPreview,
  onRestore,
  onSettings,
  onUnpublish,
  userId,
}: {
  forms: FormRecord[];
  loading: boolean;
  userId?: string;
  onArchive: (form: FormRecord) => void;
  onCopyLink: (form: FormRecord) => void;
  onDelete: (form: FormRecord) => void;
  onDuplicate: (form: FormRecord) => void;
  onEdit: (form: FormRecord) => void;
  onEditUrl: (form: FormRecord) => void;
  onLifecycle: (form: FormRecord) => void;
  onNew: () => void;
  onOpenLive: (form: FormRecord) => void;
  onProjectAssigned?: (formId: string, projectId: string | null) => void;
  projectAssignmentsLoading?: boolean;
  onPreview: (form: FormRecord) => void;
  onRestore: (form: FormRecord) => void;
  onSettings: (form: FormRecord) => void;
  onUnpublish: (form: FormRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const visibleForms = forms.filter((form) => {
    const matchesQuery = `${form.title} ${form.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    const matchesStatus =
      status === "all" ||
      (status === "archived"
        ? form.status === "archived"
        : status === "active"
          ? form.status !== "archived"
          : formState(form).toLowerCase().replace(" ", "_") === status);
    return matchesQuery && matchesStatus;
  });
  const selection = useTableSelection(visibleForms.map((form) => form.id));
  const selectedForms = visibleForms.filter((form) =>
    selection.selectedVisibleIds.includes(form.id),
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="pb-12">
      <TableFilterBar>
        <TableSearchField
          value={query}
          onValueChange={setQuery}
          placeholder="Search forms"
          aria-label="Search forms"
        />
        <TableFilterSelect
          value={status}
          onValueChange={setStatus}
          label="Filter forms by status"
          options={[
            { value: "active", label: "Active forms" },
            { value: "all", label: "All forms" },
            { value: "draft", label: "Draft" },
            { value: "published", label: "Published" },
            { value: "paused", label: "Paused" },
            { value: "unpublished_changes", label: "Unpublished changes" },
            { value: "archived", label: "Archived" },
          ]}
        />
      </TableFilterBar>
      <TableSelectionBar
        className="mt-3"
        totalCount={visibleForms.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="forms"
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            downloadCsvFile(
              "maxform-forms-selected.csv",
              ["Form", "Status", "Fields", "Responses", "Updated"],
              selectedForms.map((form) => [
                form.title,
                formState(form),
                form.fieldCount ?? form.fields.length,
                form.responseCount,
                form.updatedAt,
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" />
          Export selected
        </Button>
      </TableSelectionBar>

      {forms.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={FileText}
            title="No forms yet"
            description="Choose a template or start blank. Your forms and real response totals will appear here."
            action={
              <Button type="button" onClick={onNew}>
                <Plus className="h-4 w-4" />
                Create form
              </Button>
            }
          />
        </div>
      ) : visibleForms.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={ListFilter}
            title="No matching forms"
            description="Clear the search or change the status filter."
          />
        </div>
      ) : (
        <div className="mt-5 border-y border-border">
          <div className="hidden grid-cols-[36px_minmax(0,1fr)_110px_110px_150px_40px] gap-4 border-b border-border px-3 py-3 text-[10px] font-semibold uppercase text-muted-foreground md:grid">
            <span />
            <span>Form</span>
            <span>Status</span>
            <span>Responses</span>
            <span>Updated</span>
            <span />
          </div>
          {visibleForms.map((form) => {
            const state = formState(form);
            return (
              <div
                key={form.id}
                className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-3 border-b border-border px-3 py-4 last:border-b-0 [&>*:not(:first-child)]:col-start-2 md:grid-cols-[36px_minmax(0,1fr)_110px_110px_150px_40px] md:items-center md:gap-4 md:[&>*:not(:first-child)]:col-start-auto"
              >
                <TableRowSelect
                  checked={selection.isSelected(form.id)}
                  onCheckedChange={(checked) =>
                    selection.toggle(form.id, checked)
                  }
                  label={`Select ${form.title}`}
                  className="-ml-2"
                />
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onEdit(form)}
                    className="min-w-0 max-w-full text-left"
                  >
                    <p className="truncate text-[14px] font-medium hover:text-primary">
                      {form.title}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {form.fieldCount ?? form.fields.length} fields
                      {form.settings.payment.enabled ? " - payment enabled" : ""}
                    </p>
                  </button>
                  {/* Filing a form under a project is optional; an unassigned
                      form stays exactly where it is in this list. */}
                  <ProjectPicker
                    assignmentLoading={projectAssignmentsLoading}
                    kind="form"
                    itemId={form.id}
                    projectId={form.projectId}
                    projectName={form.projectName}
                    userId={userId}
                    onAssigned={(projectId) =>
                      onProjectAssigned?.(form.id, projectId)
                    }
                    className="mt-1.5 h-7 max-w-[220px] px-2 text-[11px]"
                  />
                </div>
                <div>
                  <span
                    className={cn(
                      "inline-flex rounded px-2 py-1 text-[10px] font-medium",
                      formStateClasses(state),
                    )}
                  >
                    {state}
                  </span>
                </div>
                <p className="text-[13px] font-medium">
                  {form.responseCount.toLocaleString()}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {form.updatedAt
                    ? new Date(form.updatedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "Unknown"}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setOpenMenu((current) =>
                      current === form.id ? null : form.id,
                    )
                  }
                  className="absolute right-2 top-3 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:static"
                  aria-label={`Actions for ${form.title}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {openMenu === form.id && (
                  <div className="absolute right-3 top-12 z-20 w-[210px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl md:top-14">
                    {form.status !== "archived" && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            onEdit(form);
                          }}
                          className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                        >
                          <FormInput className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            onPreview(form);
                          }}
                          className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                        >
                          <MousePointer2 className="h-3.5 w-3.5" />
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            onSettings(form);
                          }}
                          className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                        >
                          <Settings className="h-3.5 w-3.5" />
                          Form settings
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            onEditUrl(form);
                          }}
                          className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Edit URL
                        </button>
                        {form.status === "published" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenu(null);
                                onOpenLive(form);
                              }}
                              className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Open live form
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenu(null);
                                onCopyLink(form);
                              }}
                              className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              Copy live link
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenu(null);
                                onLifecycle(form);
                              }}
                              className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                            >
                              {form.settings.lifecycle === "paused" ? (
                                <Play className="h-3.5 w-3.5" />
                              ) : (
                                <Pause className="h-3.5 w-3.5" />
                              )}
                              {form.settings.lifecycle === "paused"
                                ? "Resume"
                                : "Pause"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenu(null);
                                onUnpublish(form);
                              }}
                              className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                            >
                              <X className="h-3.5 w-3.5" />
                              Unpublish
                            </button>
                          </>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        onDuplicate(form);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Duplicate
                    </button>
                    {form.status === "archived" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(null);
                          onRestore(form);
                        }}
                        className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(null);
                          onArchive(form);
                        }}
                        className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] hover:bg-accent"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Archive
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        onDelete(form);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-[12px] text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResponsesView({
  form,
  forms,
  loading,
  onRefresh,
  onSelectForm,
  payments,
  submissions,
  userId,
  workflows,
}: {
  form: FormRecord | null;
  forms: FormRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onSelectForm: (formId: string) => void;
  payments: FormPayment[];
  submissions: FormSubmission[];
  userId?: string;
  workflows: FormWorkflow[];
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<FormSubmission | null>(null);
  const [bulkWorking, setBulkWorking] = useState(false);
  const visibleFields = (form?.fields || [])
    .filter(
      (field) =>
        ![
          "section",
          "pageBreak",
          "heading",
          "divider",
          "html",
          "hidden",
          "calculated",
        ].includes(field.type),
    )
    .slice(0, 3);
  const filtered = submissions.filter((submission) => {
    const matchesStatus =
      status === "all" || getSubmissionStatus(submission) === status;
    const matchesQuery =
      !query.trim() ||
      JSON.stringify(submission.data)
        .toLowerCase()
        .includes(query.trim().toLowerCase());
    return matchesStatus && matchesQuery;
  });
  const filteredIds = filtered.map((submission) => submission.id);
  const selectedVisible = selected.filter((id) => filteredIds.includes(id));
  const allFilteredSelected =
    filteredIds.length > 0 && selectedVisible.length === filteredIds.length;

  useEffect(() => {
    setSelected([]);
  }, [form?.id]);

  const exportCsv = () => {
    if (!form) return;
    const headers = [
      "Submission ID",
      "Status",
      "Submitted at",
      ...form.fields.map((field) => field.label),
    ];
    const rows = filtered.map((submission) => [
      submission.id,
      getSubmissionStatus(submission),
      submission.submittedAt,
      ...form.fields.map((field) => answerText(submission.data[field.id])),
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-responses.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const updateSelectedSubmissions = async (
    mode: "tag" | "rerun" | "delete",
  ) => {
    if (!userId || !form || selectedVisible.length === 0) return;
    setBulkWorking(true);
    try {
      if (mode === "delete") {
        await deleteFormSubmissions(userId, form.id, selectedVisible);
      } else {
        const target = submissions.filter((item) =>
          selectedVisible.includes(item.id),
        );
        await Promise.all(
          target.map((submission) => {
            const meta = getSubmissionMeta(submission);
            return updateFormSubmission(userId, {
              ...submission,
              data: {
                ...submission.data,
                _meta: {
                  ...meta,
                  ...(mode === "tag"
                    ? {
                        tags: Array.from(
                          new Set([
                            ...(Array.isArray(meta.tags) ? meta.tags : []),
                            "review",
                          ]),
                        ),
                      }
                    : { automationRerunRequestedAt: new Date().toISOString() }),
                },
              },
            });
          }),
        );
      }
      setSelected([]);
      await onRefresh();
      toast({
        title:
          mode === "delete"
            ? "Responses deleted"
            : mode === "tag"
              ? "Review tag added"
              : "Automation re-run queued",
      });
    } catch (error) {
      toast({
        title: "Bulk action failed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBulkWorking(false);
    }
  };

  if (forms.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Create a form first"
        description="Responses are always shown against the exact form that collected them."
      />
    );
  }

  return (
    <div className="pb-12">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <FormSelector
          forms={forms}
          selectedFormId={form?.id || null}
          setSelectedFormId={onSelectForm}
        />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <TableFilterBar className="mt-5">
        <TableSearchField
          value={query}
          onValueChange={setQuery}
          placeholder="Search response values"
          aria-label="Search responses"
        />
        <TableFilterSelect
          value={status}
          onValueChange={setStatus}
          label="Filter responses by status"
          options={[
            { value: "all", label: "All responses" },
            { value: "completed", label: "Completed" },
            { value: "partial", label: "Partial" },
          ]}
        />
      </TableFilterBar>

      <TableSelectionBar
        className="mt-3"
        totalCount={filtered.length}
        selectedCount={selectedVisible.length}
        allSelected={allFilteredSelected}
        partiallySelected={
          selectedVisible.length > 0 &&
          selectedVisible.length < filteredIds.length
        }
        onToggleAll={(checked) =>
          setSelected((current) =>
            checked
              ? Array.from(new Set([...current, ...filteredIds]))
              : current.filter((id) => !filteredIds.includes(id)),
          )
        }
        onClear={() => setSelected([])}
        itemLabel="responses"
      >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => updateSelectedSubmissions("tag")}
            disabled={bulkWorking}
          >
            <Tag className="h-4 w-4" />
            Tag for review
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => updateSelectedSubmissions("rerun")}
            disabled={bulkWorking}
          >
            <RefreshCw className="h-4 w-4" />
            Re-run automation
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => updateSelectedSubmissions("delete")}
            disabled={bulkWorking}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
      </TableSelectionBar>

      {loading ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={Inbox}
            title={submissions.length === 0 ? "No responses yet" : "No matching responses"}
            description={
              submissions.length === 0
                ? "Completed and partial submissions will appear here with their captured form version."
                : "Change the search or status filter."
            }
          />
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto border-y border-border">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[10px] font-semibold uppercase text-muted-foreground">
                <th className="w-10 px-3 py-3">
                  <Checkbox
                    checked={
                      filtered.length > 0 &&
                      filtered.every((item) => selected.includes(item.id))
                    }
                    onCheckedChange={(checked) =>
                      setSelected(checked ? filtered.map((item) => item.id) : [])
                    }
                    aria-label="Select all responses"
                  />
                </th>
                <th className="px-3 py-3">Submitted</th>
                <th className="px-3 py-3">Status</th>
                {visibleFields.map((field) => (
                  <th key={field.id} className="px-3 py-3">
                    {field.label}
                  </th>
                ))}
                <th className="px-3 py-3">Device</th>
                <th className="w-10 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((submission) => {
                const submissionStatus = getSubmissionStatus(submission);
                return (
                  <tr
                    key={submission.id}
                    className="border-b border-border text-[12px] last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-3 py-4">
                      <Checkbox
                        checked={selected.includes(submission.id)}
                        onCheckedChange={(checked) =>
                          setSelected((current) =>
                            checked
                              ? [...current, submission.id]
                              : current.filter((id) => id !== submission.id),
                          )
                        }
                        aria-label={`Select response ${submission.id}`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">
                      {new Date(submission.submittedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={cn(
                          "rounded px-2 py-1 text-[10px] font-medium capitalize",
                          submissionStatus === "completed"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {submissionStatus}
                      </span>
                    </td>
                    {visibleFields.map((field) => (
                      <td
                        key={field.id}
                        className="max-w-[220px] px-3 py-4"
                      >
                        <ResponseAnswer compact value={submission.data[field.id]} />
                      </td>
                    ))}
                    <td className="px-3 py-4">
                      {detectDevice(submission.userAgent)}
                    </td>
                    <td className="px-3 py-4">
                      <button
                        type="button"
                        onClick={() => setDetail(submission)}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={`Open response ${submission.id}`}
                      >
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[88vh] max-w-[900px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Response details</DialogTitle>
            <DialogDescription>
              Answers and linked form context from this submission.
            </DialogDescription>
          </DialogHeader>
          {detail && form && (
            <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="border-y border-border">
                {form.fields
                  .filter(
                    (field) =>
                      !["pageBreak", "divider", "heading", "section", "html"].includes(
                        field.type,
                      ),
                  )
                  .map((field) => (
                    <div
                      key={field.id}
                      className="grid gap-1 border-b border-border py-4 last:border-b-0 sm:grid-cols-[180px_1fr]"
                    >
                      <p className="text-[11px] font-medium text-muted-foreground">
                        {field.label}
                      </p>
                      <div className="min-w-0 text-[13px]">
                        <ResponseAnswer value={detail.data[field.id]} />
                      </div>
                    </div>
                  ))}
              </div>
              <aside className="space-y-6">
                <div>
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                    Submission
                  </p>
                  <div className="mt-3 space-y-2 text-[12px]">
                    <p>{new Date(detail.submittedAt).toLocaleString()}</p>
                    <p className="capitalize">
                      {getSubmissionStatus(detail)} response
                    </p>
                    <p>{detectDevice(detail.userAgent)}</p>
                    <p>
                      Captured under v
                      {String(getSubmissionMeta(detail).formVersion || form.settings.version || 0)}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                    Contact
                  </p>
                  <p className="mt-3 text-[12px] text-muted-foreground">
                    {answerText(
                      form.fields
                        .filter((field) => field.type === "email")
                        .map((field) => detail.data[field.id])
                        .find(Boolean),
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                    Payment
                  </p>
                  <p className="mt-3 text-[12px] text-muted-foreground">
                    {payments.find(
                      (payment) => payment.submissionId === detail.id,
                    )?.status || "No linked payment"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                    Automations
                  </p>
                  <p className="mt-3 text-[12px] text-muted-foreground">
                    {workflows.filter((workflow) => workflow.enabled).length} active
                    workflow runs eligible
                  </p>
                </div>
              </aside>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AnalyticsView({
  analytics,
  forms,
  loading,
  onRefresh,
  onViewForms,
}: {
  analytics: WorkspaceFormAnalytics | null;
  forms: FormRecord[];
  loading: boolean;
  onRefresh: () => void;
  onViewForms: () => void;
}) {
  const totals = analytics?.totals || {
    completed: 0,
    currency: "USD",
    paidResponses: 0,
    partial: 0,
    responses: 0,
    revenue: 0,
  };
  const completionRate =
    totals.responses > 0
      ? Math.round((totals.completed / totals.responses) * 100)
      : 0;
  const daily = analytics?.daily || [];
  const devices = (["Desktop", "Mobile", "Tablet"] as const).map((device) => ({
    device,
    count:
      analytics?.devices.find((item) => item.device === device)?.count || 0,
  }));
  const countries = analytics?.countries || [];

  if (forms.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No form analytics yet"
        description="Create and publish a form to begin measuring starts, completions, drop-off, and revenue."
      />
    );
  }

  if (loading && !analytics) {
    return (
      <div className="space-y-7 pb-12" aria-label="Loading form analytics">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-[280px] w-full" />
      </div>
    );
  }

  return (
    <div className="pb-12">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-[16px] font-semibold">All forms</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Workspace-wide performance across {forms.length.toLocaleString()}{" "}
            {forms.length === 1 ? "form" : "forms"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button type="button" variant="outline" onClick={onViewForms}>
            <FileText className="h-4 w-4" />
            Manage forms
          </Button>
        </div>
      </div>

      <div className="mt-6 grid border-y border-border sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Started",
            value: totals.responses.toLocaleString(),
            meta: "Across every form",
          },
          {
            label: "Completed",
            value: totals.completed.toLocaleString(),
            meta: `${completionRate}% completion`,
          },
          {
            label: "Partial",
            value: totals.partial.toLocaleString(),
            meta: "Available for re-engagement",
          },
          {
            label: "Revenue",
            value: formatCurrency(totals.revenue, totals.currency, {
              currencyDisplay: "code",
            }),
            meta:
              totals.paidResponses > 0
                ? `${totals.paidResponses} paid responses`
                : "No paid responses",
          },
        ].map((metric, index) => (
          <div
            key={metric.label}
            className={cn(
              "min-h-[128px] border-b border-border px-5 py-5 text-left sm:border-b-0",
              index > 0 && "sm:border-l",
            )}
          >
            <p className="text-[11px] text-muted-foreground">{metric.label}</p>
            <p className="mt-3 text-[26px] font-semibold">{metric.value}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{metric.meta}</p>
          </div>
        ))}
      </div>

      {totals.responses === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={BarChart3}
            title="No response activity yet"
            description="This dashboard stays empty until real submissions arrive. No sample analytics are inserted."
          />
        </div>
      ) : (
        <>
          <section className="mt-8">
            <div>
              <h3 className="text-[16px] font-semibold">
                Response and revenue trends
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Real submissions and completed payments grouped by day
              </p>
            </div>
            <div className="mt-5 h-[280px] border-y border-border py-5">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={daily}
                  margin={{ top: 5, right: 12, left: -24, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="forms-response-fill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="hsl(var(--primary))"
                        stopOpacity={0.28}
                      />
                      <stop
                        offset="100%"
                        stopColor="hsl(var(--primary))"
                        stopOpacity={0}
                      />
                    </linearGradient>
                    <linearGradient
                      id="forms-revenue-fill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#10B981"
                        stopOpacity={0.2}
                      />
                      <stop
                        offset="100%"
                        stopColor="#10B981"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="hsl(var(--border))"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="responses"
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  />
                  {totals.revenue > 0 && (
                    <YAxis
                      yAxisId="revenue"
                      orientation="right"
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) =>
                        formatCurrency(Number(value), totals.currency, {
                          currencyDisplay: "narrowSymbol",
                          notation: "compact",
                        })
                      }
                      tick={{
                        fill: "hsl(var(--muted-foreground))",
                        fontSize: 10,
                      }}
                    />
                  )}
                  <ChartTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      color: "hsl(var(--popover-foreground))",
                      fontSize: 12,
                    }}
                    formatter={(value: number, name: string) =>
                      name === "revenue"
                        ? [
                            formatCurrency(Number(value), totals.currency),
                            "Revenue",
                          ]
                        : [Number(value).toLocaleString(), "Responses"]
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="responses"
                    name="responses"
                    yAxisId="responses"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#forms-response-fill)"
                  />
                  {totals.revenue > 0 && (
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="revenue"
                      yAxisId="revenue"
                      stroke="#10B981"
                      strokeWidth={2}
                      fill="url(#forms-revenue-fill)"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <section>
              <h3 className="text-[16px] font-semibold">Completion funnel</h3>
              <div className="mt-5 space-y-4 border-y border-border py-5">
                {[
                  { label: "Started", count: totals.responses },
                  { label: "Completed", count: totals.completed },
                  { label: "Dropped off", count: totals.partial },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="block w-full text-left"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span>{item.label}</span>
                      <span>{item.count}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{
                          width: `${totals.responses ? (item.count / totals.responses) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h3 className="text-[16px] font-semibold">Traffic & device</h3>
              <div className="mt-5 grid grid-cols-2 border-y border-border">
                <div className="py-5 pr-5">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Devices
                  </p>
                  <div className="mt-4 space-y-3">
                    {devices.map((item) => (
                      <div key={item.device} className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-2">
                          {item.device === "Mobile" ? (
                            <Smartphone className="h-3.5 w-3.5" />
                          ) : (
                            <Laptop className="h-3.5 w-3.5" />
                          )}
                          {item.device}
                        </span>
                        <span>{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-l border-border py-5 pl-5">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Countries
                  </p>
                  <div className="mt-4 space-y-3">
                    {countries.length > 0 ? (
                      countries
                        .slice(0, 4)
                        .map(({ country, count }) => (
                          <div key={country} className="flex items-center justify-between text-[11px]">
                            <span className="truncate">{country}</span>
                            <span>{count}</span>
                          </div>
                        ))
                    ) : (
                      <p className="text-[11px] leading-5 text-muted-foreground">
                        Country data appears on new responses.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
          <section className="mt-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h3 className="text-[16px] font-semibold">
                  Performance by form
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Compare response volume, completion and workspace-currency
                  revenue
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Updated{" "}
                {analytics?.generatedAt
                  ? new Date(analytics.generatedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "now"}
              </span>
            </div>
            <div className="dashboard-scroll mt-5 overflow-x-auto border-y border-border">
              <table className="w-full min-w-[680px] text-left">
                <thead className="border-b border-border text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  <tr>
                    <th className="py-3 pr-4 font-medium">Form</th>
                    <th className="py-3 pr-4 text-right font-medium">
                      Responses
                    </th>
                    <th className="py-3 pr-4 text-right font-medium">
                      Completed
                    </th>
                    <th className="py-3 pr-4 text-right font-medium">
                      Completion
                    </th>
                    <th className="py-3 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(analytics?.forms || []).map((item) => (
                    <tr key={item.formId} className="text-[11px]">
                      <td className="max-w-[300px] truncate py-3 pr-4 font-medium">
                        {item.title}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-muted-foreground">
                        {item.responses.toLocaleString()}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-muted-foreground">
                        {item.completed.toLocaleString()}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono">
                        {item.responses
                          ? `${Math.round(
                              (item.completed / item.responses) * 100,
                            )}%`
                          : "0%"}
                      </td>
                      <td className="py-3 text-right font-mono">
                        {formatCurrency(item.revenue, totals.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function FormSettingsView({
  form,
  onChange,
  onSlugChange,
  slug,
  slugStatus,
}: {
  form: FormRecord;
  onChange: (form: FormRecord) => void;
  onSlugChange: (slug: string) => void;
  slug: string;
  slugStatus: SlugStatus;
}) {
  const { user } = useAuth();
  const settings = form.settings;
  const update = (patch: Partial<typeof settings>) =>
    onChange({ ...form, settings: { ...settings, ...patch } });
  return (
    <div className="mx-auto max-w-[840px] border-y border-border">
      <section className="grid gap-5 border-b border-border py-6 md:grid-cols-[210px_minmax(0,1fr)] md:gap-8">
        <div>
          <h3 className="text-[14px] font-semibold">Public link</h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            The unique address used when this form is published.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="public-form-slug">Form URL</Label>
          <div className="flex min-w-0 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <span className="hidden shrink-0 border-r border-border px-3 text-[11px] text-muted-foreground sm:block">
              {window.location.origin}/forms/{user?.short_id}/
            </span>
            <Input
              id="public-form-slug"
              value={slug}
              onChange={(event) => onSlugChange(event.target.value)}
              className="min-w-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-describedby="public-form-slug-status"
            />
          </div>
          <div
            id="public-form-slug-status"
            className="flex min-h-5 items-center gap-2 text-[11px]"
            aria-live="polite"
          >
            {slugStatus === "checking" && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">
                  Checking availability
                </span>
              </>
            )}
            {slugStatus === "available" && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-700 dark:text-emerald-400">
                  This URL is available
                </span>
              </>
            )}
            {(slugStatus === "taken" || slugStatus === "error") && (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                <span className="text-destructive">
                  {slugStatus === "taken"
                    ? "This URL is already in use"
                    : "Availability could not be checked"}
                </span>
              </>
            )}
            {slugStatus === "invalid" && (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                <span className="text-destructive">
                  Use at least three letters or numbers
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 border-b border-border py-6 md:grid-cols-[210px_minmax(0,1fr)] md:gap-8">
        <div>
          <h3 className="text-[14px] font-semibold">Notifications</h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Alert the right people when a response is completed.
          </p>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-6 border-y border-border py-3">
            <div>
              <p className="text-[12px] font-medium">Email notifications</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Send one message per completed submission
              </p>
            </div>
            <Switch
              checked={settings.notifications.enabled}
              onCheckedChange={(enabled) =>
                update({
                  notifications: { ...settings.notifications, enabled },
                })
              }
            />
          </div>
          {settings.notifications.enabled && (
            <div className="space-y-2">
              <Label htmlFor="notification-recipients">Recipients</Label>
              <Input
                id="notification-recipients"
                value={settings.notifications.recipients}
                onChange={(event) =>
                  update({
                    notifications: {
                      ...settings.notifications,
                      recipients: event.target.value,
                    },
                  })
                }
                placeholder="team@example.com, owner@example.com"
              />
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 border-b border-border py-6 md:grid-cols-[210px_minmax(0,1fr)] md:gap-8">
        <div>
          <h3 className="text-[14px] font-semibold">Access</h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Decide who can open and submit this form.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Audience</Label>
            <Select
              value={settings.access.mode}
              onValueChange={(mode: typeof settings.access.mode) =>
                update({ access: { ...settings.access, mode } })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Anyone with the link</SelectItem>
                <SelectItem value="password">Password protected</SelectItem>
                <SelectItem value="authenticated">Logged-in contacts</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {settings.access.mode === "password" && (
            <div className="space-y-2">
              <Label htmlFor="form-password">Password</Label>
              <Input
                id="form-password"
                type="password"
                value={settings.access.password}
                onChange={(event) =>
                  update({
                    access: {
                      ...settings.access,
                      password: event.target.value,
                    },
                  })
                }
              />
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 border-b border-border py-6 md:grid-cols-[210px_minmax(0,1fr)] md:gap-8">
        <div>
          <h3 className="text-[14px] font-semibold">Response limits</h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Set collection limits and prevent duplicate entries.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="response-limit">Maximum submissions</Label>
            <Input
              id="response-limit"
              type="number"
              min="1"
              value={settings.limits.responseLimit ?? ""}
              onChange={(event) =>
                update({
                  limits: {
                    ...settings.limits,
                    responseLimit:
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                  },
                })
              }
              placeholder="Unlimited"
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-y border-border py-2">
            <div>
              <p className="text-[12px] font-medium">One per email</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Prevent repeat submissions
              </p>
            </div>
            <Switch
              checked={settings.limits.onePerEmail}
              onCheckedChange={(onePerEmail) =>
                update({
                  limits: { ...settings.limits, onePerEmail },
                })
              }
            />
          </div>
        </div>
      </section>

      <section className="grid gap-5 py-6 md:grid-cols-[210px_minmax(0,1fr)] md:gap-8">
        <div>
          <h3 className="text-[14px] font-semibold">Submission window</h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Open and close collection automatically.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="opens-at">Opens at</Label>
            <Input
              id="opens-at"
              type="datetime-local"
              value={settings.schedule.opensAt}
              onChange={(event) =>
                update({
                  schedule: {
                    ...settings.schedule,
                    opensAt: event.target.value,
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="closes-at">Closes at</Label>
            <Input
              id="closes-at"
              type="datetime-local"
              value={settings.schedule.closesAt}
              onChange={(event) =>
                update({
                  schedule: {
                    ...settings.schedule,
                    closesAt: event.target.value,
                  },
                })
              }
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function AiGeneratorView({
  creating,
  onCreate,
  templates,
}: {
  creating: boolean;
  onCreate: (draft: GeneratedFormDraft) => void;
  templates: FormTemplate[];
}) {
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<GeneratedFormDraft | null>(null);
  const promptStarters = [
    {
      label: "Client intake",
      value:
        "Create a client intake form that collects full name, email, company, project goals, budget, and a preferred appointment. Make contact details required.",
    },
    {
      label: "Event registration",
      value:
        "Create an event registration form with attendee name, email, ticket type, session choices, and dietary requirements.",
    },
    {
      label: "Job application",
      value:
        "Create a job application form with candidate details, role, portfolio, resume upload, experience, and availability.",
    },
  ];

  const generate = () => {
    if (prompt.trim().length < 12) return;
    setDraft(generateFormFromPrompt(prompt, templates));
  };

  const updateField = (fieldId: string, patch: Partial<FormField>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            fields: current.fields.map((field) =>
              field.id === fieldId ? { ...field, ...patch } : field,
            ),
          }
        : current,
    );
  };

  return (
    <div className="pb-12">
      <div className="grid grid-cols-3 border-y border-border">
        {[
          ["01", "Brief"],
          ["02", "Review"],
          ["03", "Build"],
        ].map(([number, label], index) => (
          <div
            key={label}
            className={cn(
              "flex min-w-0 items-center gap-3 px-3 py-4 sm:px-5",
              index > 0 && "border-l border-border",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded text-[9px] font-semibold",
                (index === 0 && !draft) || (index === 1 && draft)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {number}
            </span>
            <span className="truncate text-[12px] font-medium">{label}</span>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,0.86fr)_minmax(420px,1.14fr)]">
      <section className="min-w-0">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[18px] font-semibold">Form brief</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Tell Max Builder what the finished form must collect.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {promptStarters.map((starter) => (
            <Button
              key={starter.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPrompt(starter.value);
                setDraft(null);
              }}
            >
              {starter.label}
            </Button>
          ))}
        </div>

        <div className="mt-6 space-y-2">
          <Label htmlFor="ai-form-prompt">Prompt</Label>
          <Textarea
            id="ai-form-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Create a client intake form called Project Discovery. Collect full name, work email, company, budget, project details, and a preferred appointment. Make all fields required."
            className="min-h-[220px] resize-none text-[14px] leading-6"
          />
          <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
            <span>{prompt.trim().length} characters</span>
            <span>Include required fields and payment needs</span>
          </div>
        </div>

        <Button
          type="button"
          className="mt-5 w-full"
          onClick={generate}
          disabled={prompt.trim().length < 12}
        >
          <Bot className="h-4 w-4" />
          Generate structure
        </Button>
      </section>

      <section className="min-w-0 border-t border-border pt-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <div>
          <h2 className="text-[18px] font-semibold">Generated structure</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Review the title and fields before creating the form.
          </p>
        </div>

        {!draft ? (
          <div className="mt-6 min-h-[430px] border-y border-border px-5 py-7">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Bot className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[13px] font-medium">Waiting for a brief</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Your editable structure will appear here.
                </p>
              </div>
            </div>
            <div className="mt-8 space-y-3 opacity-60">
              {[72, 88, 64, 80, 56].map((width, index) => (
                <div
                  key={width}
                  className="flex items-center gap-3 border-b border-border py-3"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-muted text-[9px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span
                    className="h-2 rounded bg-muted"
                    style={{ width: `${width}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <div className="grid gap-4 border-y border-border py-5">
              <div className="space-y-2">
                <Label htmlFor="generated-form-title">Form title</Label>
                <Input
                  id="generated-form-title"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="generated-form-description">Description</Label>
                <Textarea
                  id="generated-form-description"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                  className="min-h-[78px] resize-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span className="rounded bg-muted px-2 py-1">
                  {draft.sourceLabel}
                </span>
                <span className="rounded bg-muted px-2 py-1">
                  {draft.fields.length} fields
                </span>
                {draft.paymentRequested && (
                  <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-400">
                    Payment enabled
                  </span>
                )}
              </div>
            </div>

            <div className="max-h-[360px] overflow-y-auto border-b border-border">
              {draft.fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid grid-cols-[28px_minmax(0,1fr)_auto_36px] items-center gap-3 border-b border-border py-3 last:border-b-0"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <Input
                      value={field.label}
                      onChange={(event) =>
                        updateField(field.id, { label: event.target.value })
                      }
                      aria-label={`Field ${index + 1} label`}
                      className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                    />
                    <p className="text-[9px] uppercase text-muted-foreground">
                      {field.type.replace(/([A-Z])/g, " $1")}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Checkbox
                      checked={Boolean(field.required)}
                      onCheckedChange={(checked) =>
                        updateField(field.id, { required: checked === true })
                      }
                    />
                    Required
                  </label>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        fields: draft.fields.filter(
                          (item) => item.id !== field.id,
                        ),
                      })
                    }
                    aria-label={`Remove ${field.label}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              type="button"
              className="mt-5 w-full"
              onClick={() => onCreate(draft)}
              disabled={
                creating ||
                !draft.title.trim() ||
                draft.fields.length === 0 ||
                draft.fields.some((field) => !field.label.trim())
              }
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Create and edit form
            </Button>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

function FormModuleSettingsView({
  loading,
  onChange,
  onSave,
  preferences,
  saving,
}: {
  loading: boolean;
  onChange: (preferences: FormModulePreferences) => void;
  onSave: () => void;
  preferences: FormModulePreferences;
  saving: boolean;
}) {
  if (loading) {
    return (
      <div className="max-w-[780px] space-y-4 pb-12">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-[780px] pb-12">
      <section className="border-y border-border py-6">
        <h2 className="text-[16px] font-semibold">New form defaults</h2>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          These values apply to blank, template, and AI-generated forms.
        </p>

        <div className="mt-6 max-w-[360px]">
          <div className="space-y-2">
            <Label>Default access</Label>
            <Select
              value={preferences.accessMode}
              onValueChange={(accessMode: FormModulePreferences["accessMode"]) =>
                onChange({ ...preferences, accessMode })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="authenticated">
                  Logged-in contacts
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="border-b border-border py-6">
        <h2 className="text-[16px] font-semibold">Default confirmation</h2>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Forms set to inherit will use this behavior and design.
        </p>
        <div className="mt-6">
          <ConfirmationSettingsEditor
            value={preferences.confirmation}
            onChange={(confirmation) =>
              onChange({
                ...preferences,
                confirmation,
                confirmationMessage: confirmation.message,
              })
            }
          />
        </div>
      </section>

      <section className="border-b border-border py-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-[16px] font-semibold">
              Submission notifications
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Set the notification behavior inherited by new forms.
            </p>
          </div>
          <Switch
            checked={preferences.notificationsEnabled}
            onCheckedChange={(notificationsEnabled) =>
              onChange({ ...preferences, notificationsEnabled })
            }
          />
        </div>
        {preferences.notificationsEnabled && (
          <div className="mt-5 space-y-2">
            <Label htmlFor="module-notification-recipients">
              Default recipients
            </Label>
            <Input
              id="module-notification-recipients"
              value={preferences.notificationRecipients}
              onChange={(event) =>
                onChange({
                  ...preferences,
                  notificationRecipients: event.target.value,
                })
              }
              placeholder="owner@example.com, team@example.com"
            />
          </div>
        )}
      </section>

      <section className="border-b border-border py-6">
        <h2 className="text-[16px] font-semibold">Default appearance</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="module-accent-color">Accent color</Label>
            <div className="flex gap-2">
              <input
                id="module-accent-color"
                type="color"
                value={normalizeBrandColor(preferences.accentColor)}
                onChange={(event) =>
                  onChange({
                  ...preferences,
                  accentColor: event.target.value.toUpperCase(),
                  accentColorMode: "custom",
                  })
                }
                className="h-10 w-11 shrink-0 rounded-md border border-border bg-transparent p-1"
              />
              <Input
                value={preferences.accentColor}
                onChange={(event) =>
                  onChange({
                  ...preferences,
                  accentColor: event.target.value,
                  accentColorMode: "custom",
                  })
                }
                aria-label="Accent color value"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Font</Label>
            <Select
              value={preferences.fontFamily}
              onValueChange={(
                fontFamily: FormModulePreferences["fontFamily"],
              ) => onChange({ ...preferences, fontFamily })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Inter">Inter</SelectItem>
                <SelectItem value="Manrope">Manrope</SelectItem>
                <SelectItem value="DM Sans">DM Sans</SelectItem>
                <SelectItem value="Source Sans 3">Source Sans 3</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Respondent theme</Label>
            <Select
              value={preferences.respondentMode}
              onValueChange={(
                respondentMode: FormModulePreferences["respondentMode"],
              ) => onChange({ ...preferences, respondentMode })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Follow device</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <div className="mt-6 flex justify-end">
        <Button
          type="button"
          onClick={onSave}
          disabled={
            saving ||
            (preferences.confirmation.type !== "redirect" &&
              !preferences.confirmation.message.trim()) ||
            (preferences.confirmation.type !== "message" &&
              !preferences.confirmation.redirectUrl.trim())
          }
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save module settings
        </Button>
      </div>
    </div>
  );
}

function FormPreviewDialog({
  form,
  onOpenChange,
}: {
  form: FormRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  return (
    <Dialog open={Boolean(form)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-24px)] max-w-[1040px] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 pr-14">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <DialogTitle className="truncate text-[17px]">
                {form?.title || "Form preview"}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[11px]">
                Respondent preview
              </DialogDescription>
            </div>
            <div
              className="flex w-fit items-center rounded-md border border-border p-1"
              aria-label="Preview size"
            >
              <button
                type="button"
                onClick={() => setDevice("desktop")}
                className={cn(
                  "flex h-8 w-9 items-center justify-center rounded",
                  device === "desktop"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Desktop preview"
                aria-pressed={device === "desktop"}
              >
                <Laptop className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setDevice("mobile")}
                className={cn(
                  "flex h-8 w-9 items-center justify-center rounded",
                  device === "mobile"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Mobile preview"
                aria-pressed={device === "mobile"}
              >
                <Smartphone className="h-4 w-4" />
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="dashboard-scroll max-h-[calc(92vh-138px)] overflow-y-auto bg-muted/30 px-3 py-5 sm:px-7 sm:py-7">
          <div
            className={cn(
              "mx-auto transition-[max-width] duration-200",
              device === "mobile" ? "max-w-[390px]" : "max-w-[820px]",
            )}
          >
            {form && <FormRenderer form={form} preview />}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-border px-5 py-3">
          <span className="hidden items-center gap-2 text-[10px] text-muted-foreground sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            Uses the live form renderer
          </span>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close preview
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormTransitionOverlay({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div
      className="absolute inset-0 z-[70] flex items-center justify-center bg-background/85 px-5 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-[300px] border-y border-border py-7 text-center">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 animate-spin" />
        </span>
        <p className="mt-4 text-[14px] font-medium">{message}</p>
        <div className="mx-auto mt-4 h-1 w-32 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

function PublishDialog({
  form,
  onConfirm,
  onOpenChange,
  onSlugChange,
  open,
  slug,
  slugStatus,
  warnings,
  working,
}: {
  form: FormRecord | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onSlugChange: (slug: string) => void;
  open: boolean;
  slug: string;
  slugStatus: SlugStatus;
  warnings: string[];
  working: boolean;
}) {
  const { user } = useAuth();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {form?.status === "published" ? "Update form" : "Publish form"}
          </DialogTitle>
          <DialogDescription>
            {warnings.length > 0
              ? "Review the changes that can affect future submissions."
              : "This creates a new version and makes the current draft live."}
          </DialogDescription>
        </DialogHeader>
        {form && (
          <div className="space-y-2 border-y border-border py-4">
            <Label htmlFor="publish-form-slug">Public URL</Label>
            <div className="flex min-w-0 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <span className="hidden shrink-0 border-r border-border px-3 text-[11px] text-muted-foreground sm:block">
                {window.location.origin}/forms/{user?.short_id}/
              </span>
              <Input
                id="publish-form-slug"
                value={slug}
                onChange={(event) => onSlugChange(event.target.value)}
                className="min-w-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            <div className="flex min-h-5 items-center gap-2 text-[11px]">
              {slugStatus === "checking" && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Checking availability
                  </span>
                </>
              )}
              {slugStatus === "available" && (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-700 dark:text-emerald-400">
                    This URL is available
                  </span>
                </>
              )}
              {(slugStatus === "taken" ||
                slugStatus === "invalid" ||
                slugStatus === "error") && (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-destructive">
                    {slugStatus === "taken"
                      ? "This URL is already in use"
                      : slugStatus === "invalid"
                        ? "Use at least three letters or numbers"
                        : "Availability could not be checked"}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="border-y border-amber-500/30 bg-amber-500/5 py-2">
            {warnings.map((warning) => (
              <div
                key={warning}
                className="flex gap-3 border-b border-amber-500/20 px-3 py-3 last:border-b-0"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-[12px] leading-5">{warning}</p>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            Keep editing
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={
              working ||
              slugStatus === "checking" ||
              slugStatus === "taken" ||
              slugStatus === "invalid"
            }
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" />}
            {form?.status === "published" ? "Update" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FormsModule({
  activeTab,
  embedded = false,
  fullName,
  onDraftGuardChange,
  onTabChange,
  projectId = null,
  userId,
}: FormsModuleProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currency: workspaceCurrency } = useWorkspaceRegion();
  const workspaceAccent = readBrandColor(DEFAULT_WORKSPACE_ACCENT);
  const cachedBootstrap = useMemo(
    () => readFormsBootstrapCache(userId),
    [userId],
  );
  const [forms, setForms] = useState<FormRecord[]>(
    () => cachedBootstrap?.forms || [],
  );
  // Everything the user browses goes through this lens. `forms` stays the full
  // workspace list so saving, selection, and slug checks keep working against
  // the real set; only what is shown is narrowed to the project.
  const visibleForms = useMemo(
    () =>
      projectId ? forms.filter((form) => form.projectId === projectId) : forms,
    [forms, projectId],
  );
  const [templates, setTemplates] = useState<FormTemplate[]>(
    () => cachedBootstrap?.templates || [],
  );
  const [selectedFormId, setSelectedFormId] = useState<string | null>(() => {
    if (!userId) return null;
    return sessionStorage.getItem(selectedFormKey(userId));
  });
  const [editingFormId, setEditingFormId] = useState<string | null>(() => {
    if (!userId) return null;
    try {
      return sessionStorage.getItem(activeFormEditorKey(userId));
    } catch {
      return null;
    }
  });
  const [previewFormId, setPreviewFormId] = useState<string | null>(null);
  const [settingsFormId, setSettingsFormId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [payments, setPayments] = useState<FormPayment[]>([]);
  const [workflows, setWorkflows] = useState<FormWorkflow[]>([]);
  const [workspaceAnalytics, setWorkspaceAnalytics] =
    useState<WorkspaceFormAnalytics | null>(null);
  const [workspaceAnalyticsLoading, setWorkspaceAnalyticsLoading] =
    useState(false);
  const [paymentProducts, setPaymentProducts] = useState<PaymentProduct[]>(
    () => cachedBootstrap?.paymentProducts || [],
  );
  const [paymentProviderConnections, setPaymentProviderConnections] = useState<
    PaymentProviderConnection[]
  >(() => cachedBootstrap?.paymentProviderConnections || []);
  const [loading, setLoading] = useState(
    Boolean(userId && !cachedBootstrap),
  );
  const [contextLoading, setContextLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [creatingGeneratedForm, setCreatingGeneratedForm] = useState(false);
  const [modulePreferences, setModulePreferences] =
    useState<FormModulePreferences>(
      () => cachedBootstrap?.preferences || defaultFormModulePreferences,
    );
  const [modulePreferencesLoading, setModulePreferencesLoading] =
    useState(Boolean(userId && !cachedBootstrap));
  const [formsHydrated, setFormsHydrated] = useState(
    Boolean(cachedBootstrap?.hydrated),
  );
  const [moduleSettingsSaving, setModuleSettingsSaving] = useState(false);
  const [formSettingsSaving, setFormSettingsSaving] = useState(false);
  const [formSlugDraft, setFormSlugDraft] = useState("");
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");
  const [saveState, setSaveState] = useState<
    "idle" | "dirty" | "saving" | "saved" | "error"
  >("idle");
  const [manualDraftSaving, setManualDraftSaving] = useState(false);
  const [draftRecoveryVersion, setDraftRecoveryVersion] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishWarnings, setPublishWarnings] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const [pendingBuilderExit, setPendingBuilderExit] = useState<
    (() => void) | null
  >(null);
  const [exitSaving, setExitSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FormRecord | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [deleteResponses, setDeleteResponses] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const saveTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slugValidationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slugValidationRevision = useRef(0);
  const saveRevisions = useRef(new Map<string, number>());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const activeSaves = useRef(
    new Map<string, Promise<FormRecord | null>>(),
  );
  const formsRef = useRef<FormRecord[]>(cachedBootstrap?.forms || []);
  const hasBootstrapCache = useRef(Boolean(cachedBootstrap));
  const formsHydratedRef = useRef(Boolean(cachedBootstrap?.hydrated));
  const formsHydrationRequest = useRef<Promise<FormRecord[]> | null>(null);
  const restoredDraftIds = useRef(new Set<string>());
  const previousActiveTab = useRef(activeTab);

  const syncFormQueryCache = useCallback(
    (nextForms: FormRecord[]) => {
      if (!userId) return;
      if (nextForms.every((form) => !form.isSummary)) {
        queryClient.setQueryData(queryKeys.forms.hydrated(userId), nextForms);
      }
      queryClient.setQueryData<{
        forms: FormRecord[];
        templates: FormTemplate[];
      } | null>(queryKeys.forms.bootstrap(userId), (current) =>
        current
          ? {
              ...current,
              forms: nextForms,
            }
          : current,
      );
    },
    [queryClient, userId],
  );

  const handleFormProjectAssigned = useCallback(
    (formId: string, projectId: string | null) => {
      if (!userId) return;
      const nextForms = formsRef.current.map((form) =>
        form.id === formId ? { ...form, projectId } : form,
      );
      if (nextForms.every((form, index) => form === formsRef.current[index])) {
        return;
      }
      formsRef.current = nextForms;
      setForms(nextForms);
      syncFormQueryCache(nextForms);
      const cached = readFormsBootstrapCache(userId);
      if (cached) {
        writeFormsBootstrapCache(userId, {
          ...cached,
          forms: nextForms,
          hydrated: cached.hydrated || formsHydratedRef.current,
        });
      }
    },
    [syncFormQueryCache, userId],
  );

  const selectedForm =
    forms.find((form) => form.id === selectedFormId) || null;
  const editingFormCandidate =
    forms.find((form) => form.id === editingFormId) || null;
  const editingForm =
    editingFormCandidate?.isSummary ? null : editingFormCandidate;
  const previewFormCandidate =
    forms.find((form) => form.id === previewFormId) || null;
  const previewForm =
    previewFormCandidate?.isSummary ? null : previewFormCandidate;
  const settingsFormCandidate =
    forms.find((form) => form.id === settingsFormId) || null;
  const settingsForm =
    settingsFormCandidate?.isSummary ? null : settingsFormCandidate;
  const hasUnsavedChanges =
    Boolean(editingForm) &&
    (saveState === "dirty" ||
      saveState === "saving" ||
      saveState === "error");
  const requiresPublishedUpdate = Boolean(
    editingForm?.status === "published" &&
      editingForm.settings.hasUnpublishedChanges,
  );

  const rememberEditingForm = useCallback(
    (formId: string | null) => {
      setEditingFormId(formId);
      if (!userId) return;
      try {
        if (formId) {
          sessionStorage.setItem(activeFormEditorKey(userId), formId);
        } else {
          sessionStorage.removeItem(activeFormEditorKey(userId));
        }
      } catch {
        // The editor remains usable when session storage is unavailable.
      }
    },
    [userId],
  );

  useEffect(() => {
    const previousTab = previousActiveTab.current;
    if (activeTab === previousTab) return;
    if (editingFormId && (hasUnsavedChanges || requiresPublishedUpdate)) {
      const requestedTab = activeTab;
      onTabChange(previousTab);
      setPendingBuilderExit(
        () => () => {
          rememberEditingForm(null);
          previousActiveTab.current = requestedTab;
          onTabChange(requestedTab);
        },
      );
      return;
    }
    previousActiveTab.current = activeTab;
    rememberEditingForm(null);
    setPreviewFormId(null);
    setSettingsFormId(null);
  }, [
    activeTab,
    editingFormId,
    hasUnsavedChanges,
    onTabChange,
    requiresPublishedUpdate,
    rememberEditingForm,
  ]);

  const hydrateWorkspaceForms = useCallback(() => {
    if (!userId) return Promise.resolve([] as FormRecord[]);
    if (formsHydrationRequest.current) return formsHydrationRequest.current;

    const request = queryClient.fetchQuery({
      queryFn: () => listWorkspaceForms(userId),
      queryKey: queryKeys.forms.hydrated(userId),
      staleTime: SERVER_STATE_STALE_TIME,
    })
      .then((nextForms) => {
        const recovered = new Set<string>();
        const hydratedForms = nextForms.map((form) => {
          const result = restoreFormDraft(localStorage, userId, form);
          if (result.restored) recovered.add(form.id);
          return result.form;
        });
        restoredDraftIds.current = recovered;
        setDraftRecoveryVersion((current) => current + 1);
        formsRef.current = hydratedForms;
        setForms(hydratedForms);
        syncFormQueryCache(hydratedForms);
        formsHydratedRef.current = true;
        setFormsHydrated(true);
        if (editingFormId && recovered.has(editingFormId)) {
          setSaveState("dirty");
        }
        return hydratedForms;
      })
      .finally(() => {
        if (formsHydrationRequest.current === request) {
          formsHydrationRequest.current = null;
        }
      });
    formsHydrationRequest.current = request;
    return request;
  }, [editingFormId, queryClient, syncFormQueryCache, userId]);

  const loadForms = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setModulePreferencesLoading(false);
      return;
    }
    setLoading(!hasBootstrapCache.current);
    setModulePreferencesLoading(!hasBootstrapCache.current);
    setLoadError(false);
    try {
      if (!hasBootstrapCache.current) {
        const cached = await getCachedServerState<FormsBootstrapCache>(
          formsPersistentBootstrapKey(userId),
        );
        if (cached?.data) {
          const cache = cached.data;
          if (!formsHydratedRef.current) {
            formsRef.current = cache.forms;
            setForms(cache.forms);
            syncFormQueryCache(cache.forms);
          }
          setTemplates(cache.templates);
          setModulePreferences(cache.preferences);
          setPaymentProducts(cache.paymentProducts || []);
          setPaymentProviderConnections(
            cache.paymentProviderConnections || [],
          );
          formsHydratedRef.current = cache.hydrated;
          setFormsHydrated(cache.hydrated);
          hasBootstrapCache.current = true;
          setLoading(false);
          setModulePreferencesLoading(false);
          setSelectedFormId((current) => {
            const stored = sessionStorage.getItem(selectedFormKey(userId));
            const preferred = current || stored;
            if (
              preferred &&
              cache.forms.some((form) => form.id === preferred)
            ) {
              return preferred;
            }
            return (
              cache.forms.find((form) => form.status !== "archived")?.id ||
              cache.forms[0]?.id ||
              null
            );
          });
          if (
            cache.hydrated &&
            Date.now() - cached.updatedAt < SERVER_STATE_STALE_TIME
          ) {
            return;
          }
        }
      }
      const {
        forms: nextForms,
        templates: nextTemplates,
      } = await queryClient.fetchQuery({
        queryFn: () => loadFormModuleBootstrap(userId),
        queryKey: queryKeys.forms.bootstrap(userId),
        staleTime: SERVER_STATE_STALE_TIME,
      });
      if (!formsHydratedRef.current) {
        formsRef.current = nextForms;
        setForms(nextForms);
        syncFormQueryCache(nextForms);
      }
      setTemplates(nextTemplates);
      const preferences =
        cachedBootstrap?.preferences ||
        readLegacyModulePreferences(userId) ||
        defaultFormModulePreferences;
      setModulePreferences(preferences);
      hasBootstrapCache.current = true;
      writeFormsBootstrapCache(userId, {
        forms: formsHydratedRef.current ? formsRef.current : nextForms,
        hydrated: formsHydratedRef.current,
        preferences,
        templates: nextTemplates,
      });
      setSelectedFormId((current) => {
        const stored = sessionStorage.getItem(selectedFormKey(userId));
        const preferred = current || stored;
        if (
          preferred &&
          nextForms.some((form) => form.id === preferred)
        ) {
          return preferred;
        }
        return nextForms.find((form) => form.status !== "archived")?.id || nextForms[0]?.id || null;
      });
      try {
        const activeId = sessionStorage.getItem(activeFormEditorKey(userId));
        if (
          activeId &&
          nextForms.some((form) => form.id === activeId)
        ) {
          setEditingFormId(activeId);
        } else {
          sessionStorage.removeItem(activeFormEditorKey(userId));
          setEditingFormId(null);
        }
      } catch {
        setEditingFormId(null);
      }

      void hydrateWorkspaceForms().catch(() => {
        // Summary rows remain available while a later retry hydrates editors.
      });

      void Promise.all([
        queryClient.fetchQuery({
          queryFn: () => listPaymentProducts(userId),
          queryKey: ["forms", "payment-products", userId],
          staleTime: SERVER_STATE_STALE_TIME,
        }),
        queryClient.fetchQuery({
          queryFn: () => listPaymentProviderConnections(userId),
          queryKey: ["forms", "payment-provider-connections", userId],
          staleTime: SERVER_STATE_STALE_TIME,
        }),
      ])
        .then(([nextPaymentProducts, nextPaymentConnections]) => {
          setPaymentProducts(nextPaymentProducts);
          setPaymentProviderConnections(nextPaymentConnections);
          void setCachedServerState(
            formsPersistentBootstrapKey(userId),
            {
              forms: formsHydratedRef.current ? formsRef.current : nextForms,
              hydrated: formsHydratedRef.current,
              paymentProducts: nextPaymentProducts,
              paymentProviderConnections: nextPaymentConnections,
              preferences,
              templates: nextTemplates,
            } satisfies FormsBootstrapCache,
            "forms",
            ["forms", userId],
          );
        })
        .catch(() => {
          setPaymentProducts([]);
          setPaymentProviderConnections([]);
        });

      void queryClient.fetchQuery({
        queryFn: () => getFormModulePreferences(userId),
        queryKey: ["forms", "module-preferences", userId],
        staleTime: SERVER_STATE_STALE_TIME,
      })
        .then((storedPreferences) => {
          if (storedPreferences) {
            setModulePreferences(storedPreferences);
            localStorage.removeItem(modulePreferencesKey(userId));
            return;
          }
          return saveFormModulePreferences(userId, preferences).then(
            setModulePreferences,
          );
        })
        .catch(() => {
          // Cached or bundled defaults keep the module usable.
        });
    } catch (error) {
      if (!hasBootstrapCache.current) {
        setLoadError(true);
        toast({
          title: "Forms could not be loaded",
          description: error instanceof Error ? error.message : "Try again.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
      setModulePreferencesLoading(false);
    }
  }, [
    cachedBootstrap?.preferences,
    hydrateWorkspaceForms,
    queryClient,
    syncFormQueryCache,
    toast,
    userId,
  ]);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  useEffect(() => {
    if (!userId) return;
    const onDashboardLiveSync = (event: Event) => {
      const detail = (event as CustomEvent<DashboardLiveSyncDetail>).detail;
      if (detail?.userId && detail.userId !== userId) return;
      // Never replace the list underneath an active form editor. The next
      // pulse after the draft is saved will bring the list current.
      if (editingFormId || hasUnsavedChanges) return;
      void queryClient
        .invalidateQueries({
          exact: true,
          queryKey: queryKeys.forms.bootstrap(userId),
          refetchType: "none",
        })
        .then(() => loadForms());
    };
    window.addEventListener(DASHBOARD_LIVE_SYNC_EVENT, onDashboardLiveSync);
    return () =>
      window.removeEventListener(DASHBOARD_LIVE_SYNC_EVENT, onDashboardLiveSync);
  }, [editingFormId, hasUnsavedChanges, loadForms, queryClient, userId]);

  useEffect(() => {
    if (!userId || !hasBootstrapCache.current) return;
    const timer = setTimeout(() => {
      const cache = {
        forms,
        hydrated: formsHydrated,
        paymentProducts,
        paymentProviderConnections,
        preferences: modulePreferences,
        templates,
      } satisfies FormsBootstrapCache;
      writeFormsBootstrapCache(userId, cache);
      void setCachedServerState(
        formsPersistentBootstrapKey(userId),
        cache,
        "forms",
        ["forms", userId],
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [
    forms,
    formsHydrated,
    modulePreferences,
    paymentProducts,
    paymentProviderConnections,
    templates,
    userId,
  ]);

  useEffect(() => {
    if (!userId || activeTab !== "templates") return;
    let active = true;
    void loadPersistedFormTemplates()
      .then((nextTemplates) => {
        if (active) setTemplates(nextTemplates);
      })
      .catch(() => {
        // The bundled catalog remains available when refresh is interrupted.
      });
    return () => {
      active = false;
    };
  }, [activeTab, userId]);

  useEffect(() => {
    if (!userId || !selectedFormId) return;
    sessionStorage.setItem(selectedFormKey(userId), selectedFormId);
  }, [selectedFormId, userId]);

  const loadFormContext = useCallback(async (force = false) => {
    if (!userId || !selectedFormId) {
      setSubmissions([]);
      setPayments([]);
      setWorkflows([]);
      return;
    }
    setContextLoading(true);
    try {
      if (force) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.forms.context(userId, selectedFormId),
        });
      }
      const [nextSubmissions, nextPayments, nextWorkflows] =
        await queryClient.fetchQuery({
          queryFn: () =>
            Promise.all([
              listFormSubmissions(userId, selectedFormId),
              listFormPayments(userId, selectedFormId),
              listFormWorkflows(userId, selectedFormId),
            ]),
          queryKey: queryKeys.forms.context(userId, selectedFormId),
          staleTime: force ? 0 : SERVER_STATE_STALE_TIME,
        });
      setSubmissions(nextSubmissions);
      setPayments(nextPayments);
      setWorkflows(nextWorkflows);
    } catch (error) {
      toast({
        title: "Form activity could not be loaded",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setContextLoading(false);
    }
  }, [queryClient, selectedFormId, toast, userId]);

  useEffect(() => {
    if (activeTab !== "responses" && activeTab !== "automations") return;
    void loadFormContext();
  }, [activeTab, loadFormContext]);

  const loadAnalytics = useCallback(async (force = false) => {
    if (!userId) {
      setWorkspaceAnalytics(null);
      return;
    }
    setWorkspaceAnalyticsLoading(true);
    try {
      const key = ["forms", "workspace-analytics", userId] as const;
      if (force) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
      const next = await queryClient.fetchQuery({
        queryFn: () => loadWorkspaceFormAnalytics(userId),
        queryKey: key,
        staleTime: force ? 0 : SERVER_STATE_STALE_TIME,
      });
      setWorkspaceAnalytics(next);
    } catch (error) {
      toast({
        title: "Form analytics could not be loaded",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setWorkspaceAnalyticsLoading(false);
    }
  }, [queryClient, toast, userId]);

  useEffect(() => {
    if (activeTab !== "analytics") return;
    void loadAnalytics();
  }, [activeTab, loadAnalytics]);

  useEffect(
    () => () => {
      saveTimers.current.forEach((timer) => clearTimeout(timer));
      saveTimers.current.clear();
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
      if (slugValidationTimer.current) clearTimeout(slugValidationTimer.current);
    },
    [],
  );

  const replaceForm = useCallback((form: FormRecord) => {
    const nextForms = formsRef.current.map((item) =>
      item.id === form.id ? form : item,
    );
    formsRef.current = nextForms;
    setForms(nextForms);
    syncFormQueryCache(nextForms);
  }, [syncFormQueryCache]);

  const persistForm = useCallback((form: FormRecord) => {
    if (!userId) return Promise.reject(new Error("Sign in to save forms"));
    const pending = saveQueue.current
      .catch(() => undefined)
      .then(() => saveWorkspaceForm(userId, form));
    saveQueue.current = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }, [userId]);

  const flushFormSave = useCallback(
    (formId: string): Promise<FormRecord | null> => {
      const existing = activeSaves.current.get(formId);
      if (existing) return existing;

      const timer = saveTimers.current.get(formId);
      if (timer) {
        clearTimeout(timer);
        saveTimers.current.delete(formId);
      }

      const save = (async () => {
        if (!userId) throw new Error("Sign in to save forms");
        setSaveState("saving");

        while (true) {
          const revision = saveRevisions.current.get(formId) || 0;
          const snapshot =
            formsRef.current.find((form) => form.id === formId) || null;
          if (!snapshot) return null;

          const saved = await persistForm(snapshot);
          if ((saveRevisions.current.get(formId) || 0) !== revision) {
            continue;
          }

          replaceForm(saved);
          clearFormDraft(localStorage, userId, formId);
          restoredDraftIds.current.delete(formId);
          const pendingTimer = saveTimers.current.get(formId);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            saveTimers.current.delete(formId);
          }
          setSaveState("saved");
          return saved;
        }
      })();

      activeSaves.current.set(formId, save);
      const release = () => {
        if (activeSaves.current.get(formId) === save) {
          activeSaves.current.delete(formId);
        }
      };
      void save.then(release, release);
      return save;
    },
    [persistForm, replaceForm, userId],
  );

  const queueFormChange = (input: FormRecord) => {
    if (!userId) return;
    const form =
      input.status === "published" && input.settings.liveSnapshot
        ? {
            ...input,
            settings: {
              ...input.settings,
              hasUnpublishedChanges: true,
            },
          }
        : input;
    replaceForm(form);
    storeFormDraft(localStorage, userId, form);
    setSaveState("dirty");
    saveRevisions.current.set(
      form.id,
      (saveRevisions.current.get(form.id) || 0) + 1,
    );
    const currentTimer = saveTimers.current.get(form.id);
    if (currentTimer) clearTimeout(currentTimer);
    const timer = setTimeout(() => {
      saveTimers.current.delete(form.id);
      void flushFormSave(form.id).catch(() => {
        setSaveState("error");
      });
    }, 700);
    saveTimers.current.set(form.id, timer);
  };

  const saveNow = useCallback(
    async (form: FormRecord) => {
      if (!userId) throw new Error("Sign in to save forms");
      replaceForm(form);
      storeFormDraft(localStorage, userId, form);
      saveRevisions.current.set(
        form.id,
        (saveRevisions.current.get(form.id) || 0) + 1,
      );
      try {
        return await flushFormSave(form.id);
      } catch (error) {
        setSaveState("error");
        throw error;
      }
    },
    [flushFormSave, replaceForm, userId],
  );

  const saveCurrentDraft = useCallback(
    async (showToast = true) => {
      if (!editingFormId) return true;
      if (showToast) setManualDraftSaving(true);
      try {
        await flushFormSave(editingFormId);
        if (showToast) {
          toast({
            title: "Draft saved",
            description: "The latest form changes are synced to the database.",
          });
        }
        return true;
      } catch (error) {
        toast({
          title: "Draft was not saved",
          description: error instanceof Error ? error.message : "Try again.",
          variant: "destructive",
        });
        return false;
      } finally {
        if (showToast) setManualDraftSaving(false);
      }
    },
    [editingFormId, flushFormSave, toast],
  );

  const discardFormChanges = useCallback(async (): Promise<boolean> => {
    if (!userId || !editingForm) return false;

    try {
      if (editingForm.status === "published") {
        const liveSnapshot = editingForm.settings.liveSnapshot;
        if (!liveSnapshot) {
          throw new Error("The last live version is not available to restore.");
        }

        await saveNow({
          ...editingForm,
          slug: liveSnapshot.slug || editingForm.slug,
          title: liveSnapshot.title,
          description: liveSnapshot.description,
          fields: structuredClone(liveSnapshot.fields),
          settings: {
            ...editingForm.settings,
            theme: structuredClone(liveSnapshot.theme),
            payment: structuredClone(liveSnapshot.payment),
            version: liveSnapshot.version,
            liveSnapshot: structuredClone(liveSnapshot),
            hasUnpublishedChanges: false,
          },
        });
        setSaveState("saved");
        return true;
      }

      const formId = editingForm.id;
      const pendingTimer = saveTimers.current.get(formId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        saveTimers.current.delete(formId);
      }
      saveRevisions.current.set(
        formId,
        (saveRevisions.current.get(formId) || 0) + 1,
      );
      clearFormDraft(localStorage, userId, formId);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.forms.hydrated(userId),
      });
      await hydrateWorkspaceForms();
      setSaveState("idle");
      return true;
    } catch (error) {
      toast({
        title: "Changes were not discarded",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
      return false;
    }
  }, [editingForm, hydrateWorkspaceForms, queryClient, saveNow, toast, userId]);

  useEffect(() => {
    if (!editingFormId || !restoredDraftIds.current.has(editingFormId)) {
      return;
    }
    setSaveState("dirty");
    const timer = setTimeout(() => {
      void flushFormSave(editingFormId).catch(() => {
        setSaveState("error");
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [draftRecoveryVersion, editingFormId, flushFormSave]);

  useEffect(
    () => () => {
      onDraftGuardChange?.(null);
    },
    [onDraftGuardChange],
  );

  useEffect(() => {
    if (!hasUnsavedChanges && !requiresPublishedUpdate) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [hasUnsavedChanges, requiresPublishedUpdate]);

  const runTransition = useCallback(
    (message: string, complete: () => void, duration = 420) => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
      setTransitionMessage(message);
      transitionTimer.current = setTimeout(() => {
        complete();
        setTransitionMessage(null);
        transitionTimer.current = null;
      }, duration);
    },
    [],
  );

  const openModuleTab = (tab: FormsTab) => {
    if (tab === activeTab) return;
    const sessionKey = `maxform:forms-tab-loader:${tab}`;
    if (sessionStorage.getItem(sessionKey)) {
      onTabChange(tab);
      return;
    }
    sessionStorage.setItem(sessionKey, "seen");
    const label = tabs.find((item) => item.key === tab)?.label || "forms";
    runTransition(`Opening ${label}`, () => onTabChange(tab), 280);
  };

  const openEditor = (form: FormRecord) => {
    runTransition(
      "Opening form builder",
      () => {
        setSelectedFormId(form.id);
        rememberEditingForm(form.id);
        setSaveState(
          restoredDraftIds.current.has(form.id) ? "dirty" : "idle",
        );
        scrollDashboardToTop("auto");
      },
      520,
    );
  };

  const openPreview = (form: FormRecord) => {
    runTransition(
      "Preparing preview",
      () => {
        setSelectedFormId(form.id);
        setPreviewFormId(form.id);
      },
      360,
    );
  };

  const updateFormSlugDraft = (value: string) => {
    const normalized = normalizeFormSlug(value);
    setFormSlugDraft(normalized);
    slugValidationRevision.current += 1;
    const revision = slugValidationRevision.current;
    if (slugValidationTimer.current) {
      clearTimeout(slugValidationTimer.current);
    }
    if (normalized.length < 3) {
      setSlugStatus("invalid");
      return;
    }

    setSlugStatus("checking");
    slugValidationTimer.current = setTimeout(async () => {
      try {
        const available = await isFormSlugAvailable(
          normalized,
          settingsFormId || "",
        );
        if (slugValidationRevision.current === revision) {
          setSlugStatus(available ? "available" : "taken");
        }
      } catch {
        if (slugValidationRevision.current === revision) {
          setSlugStatus("error");
        }
      }
    }, 420);
  };

  const validateFormSlugNow = useCallback(
    async (form: FormRecord, candidateSlug = formSlugDraft) => {
      if (slugValidationTimer.current) {
        clearTimeout(slugValidationTimer.current);
      }
      const normalized = normalizeFormSlug(candidateSlug);
      if (normalized.length < 3 || normalized !== candidateSlug) {
        setSlugStatus("invalid");
        return false;
      }
      slugValidationRevision.current += 1;
      const revision = slugValidationRevision.current;
      setSlugStatus("checking");
      try {
        const available = await isFormSlugAvailable(normalized, form.id);
        if (slugValidationRevision.current === revision) {
          setSlugStatus(available ? "available" : "taken");
        }
        return available;
      } catch {
        if (slugValidationRevision.current === revision) setSlugStatus("error");
        return false;
      }
    },
    [formSlugDraft],
  );

  const openFormSettings = (form: FormRecord) => {
    setFormSlugDraft(form.slug);
    setSlugStatus("available");
    runTransition(
      "Loading form settings",
      () => {
        setSelectedFormId(form.id);
        setSettingsFormId(form.id);
      },
      360,
    );
  };

  const createBlank = async () => {
    if (!userId) return;
    setCreatingTemplateId("blank");
    try {
      const form = await createWorkspaceForm(userId, {
        title: "Untitled form",
        description: "",
        fields: [],
        projectId,
        settings: settingsFromModulePreferences(
          modulePreferences,
          workspaceCurrency,
          workspaceAccent,
        ),
      });
      formsRef.current = [form, ...formsRef.current];
      setForms(formsRef.current);
      syncFormQueryCache(formsRef.current);
      runTransition(
        "Opening form builder",
        () => {
          setSelectedFormId(form.id);
          rememberEditingForm(form.id);
          setSaveState("idle");
          scrollDashboardToTop("auto");
        },
        460,
      );
      toast({ title: "Blank form created" });
    } catch (error) {
      toast({
        title: "Form was not created",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setCreatingTemplateId(null);
    }
  };

  const useTemplate = async (templateId: string) => {
    if (!userId) return;
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setCreatingTemplateId(templateId);
    try {
      const form = await createFormFromTemplate(
        userId,
        template,
        settingsFromModulePreferences(
          modulePreferences,
          workspaceCurrency,
          workspaceAccent,
        ),
        projectId,
      );
      formsRef.current = [form, ...formsRef.current];
      setForms(formsRef.current);
      syncFormQueryCache(formsRef.current);
      runTransition(
        "Preparing template",
        () => {
          setSelectedFormId(form.id);
          rememberEditingForm(form.id);
          setSaveState("idle");
          scrollDashboardToTop("auto");
        },
        480,
      );
      toast({ title: `${template.name} is ready to edit` });
    } catch (error) {
      toast({
        title: "Template was not created",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setCreatingTemplateId(null);
    }
  };

  const duplicate = async (form: FormRecord) => {
    if (!userId) return;
    const { fields, logic } = cloneFieldsWithLogic(form);
    try {
      const copy = await createWorkspaceForm(userId, {
        title: `${form.title} copy`,
        description: form.description,
        fields,
        projectId: form.projectId,
        settings: {
          ...form.settings,
          logic,
          lifecycle: "active",
          version: 0,
          versions: [],
          liveSnapshot: null,
          hasUnpublishedChanges: false,
        },
      });
      formsRef.current = [copy, ...formsRef.current];
      setForms(formsRef.current);
      syncFormQueryCache(formsRef.current);
      runTransition(
        "Opening duplicated form",
        () => {
          setSelectedFormId(copy.id);
          rememberEditingForm(copy.id);
          setSaveState("idle");
          scrollDashboardToTop("auto");
        },
        460,
      );
      toast({ title: "Form duplicated" });
    } catch (error) {
      toast({
        title: "Form was not duplicated",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const createGeneratedForm = async (draft: GeneratedFormDraft) => {
    if (!userId) return;
    setCreatingGeneratedForm(true);
    try {
      const settings = settingsFromModulePreferences(
        modulePreferences,
        workspaceCurrency,
        workspaceAccent,
      );
      if (draft.paymentRequested) settings.payment.enabled = true;
      const form = await createWorkspaceForm(userId, {
        title: draft.title.trim(),
        description: draft.description.trim(),
        fields: draft.fields,
        projectId,
        settings,
      });
      formsRef.current = [form, ...formsRef.current];
      setForms(formsRef.current);
      syncFormQueryCache(formsRef.current);
      runTransition(
        "Opening generated form",
        () => {
          setSelectedFormId(form.id);
          rememberEditingForm(form.id);
          setSaveState("idle");
          scrollDashboardToTop("auto");
        },
        520,
      );
      toast({
        title: "Generated form created",
        description: "Review the fields in the builder before publishing.",
      });
    } catch (error) {
      toast({
        title: "Generated form was not created",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setCreatingGeneratedForm(false);
    }
  };

  const saveModulePreferences = async () => {
    if (!userId) {
      toast({
        title: "Sign in to save form settings",
        variant: "destructive",
      });
      return;
    }
    setModuleSettingsSaving(true);
    const normalized = {
      ...modulePreferences,
      accentColor: normalizeBrandColor(modulePreferences.accentColor),
      confirmation: {
        ...modulePreferences.confirmation,
        useModuleDefault: false,
        accentColor: normalizeBrandColor(
          modulePreferences.confirmation.accentColor,
        ),
        message: modulePreferences.confirmation.message.trim(),
        redirectUrl: modulePreferences.confirmation.redirectUrl.trim(),
      },
      confirmationMessage: modulePreferences.confirmation.message.trim(),
      notificationRecipients: modulePreferences.notificationRecipients.trim(),
    };
    try {
      const saved = await saveFormModulePreferences(userId, normalized);
      setModulePreferences(saved);
      localStorage.removeItem(modulePreferencesKey(userId));
      toast({
        title: "Form module settings saved",
        description: "Defaults are synced to your workspace database.",
      });
    } catch (error) {
      toast({
        title: "Form module settings were not saved",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setModuleSettingsSaving(false);
    }
  };

  const saveOpenFormSettings = async () => {
    if (!settingsForm) return;
    setFormSettingsSaving(true);
    try {
      const slugAvailable = await validateFormSlugNow(settingsForm);
      if (!slugAvailable) {
        setFormSettingsSaving(false);
        return;
      }
      await saveNow({
        ...settingsForm,
        slug: formSlugDraft,
      });
      setSettingsFormId(null);
      toast({
        title: "Form settings saved",
        description: `Public URL: ${window.location.origin}/forms/${user?.short_id}/${formSlugDraft}`,
      });
    } catch (error) {
      toast({
        title: "Form settings were not saved",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setFormSettingsSaving(false);
    }
  };

  const updateLifecycle = async (form: FormRecord) => {
    const next = {
      ...form,
      settings: {
        ...form.settings,
        lifecycle:
          form.settings.lifecycle === "paused"
            ? ("active" as const)
            : ("paused" as const),
      },
    };
    try {
      await saveNow(next);
      toast({
        title:
          next.settings.lifecycle === "paused" ? "Form paused" : "Form resumed",
      });
    } catch (error) {
      toast({
        title: "Form lifecycle was not updated",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const unpublish = async (form: FormRecord) => {
    try {
      await saveNow({
        ...form,
        status: "draft",
        settings: {
          ...form.settings,
          lifecycle: "active",
          hasUnpublishedChanges: false,
        },
      });
      toast({
        title: "Form unpublished",
        description:
          "The public link now shows an unavailable state. The draft is intact.",
      });
    } catch (error) {
      toast({
        title: "Form was not unpublished",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const copyLiveLink = async (form: FormRecord) => {
    const link = `${window.location.origin}/forms/${user?.short_id}/${form.slug}`;
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Live form link copied", description: link });
    } catch {
      toast({
        title: "Live form link",
        description: link,
      });
    }
  };

  const openLiveForm = (form: FormRecord) => {
    window.open(
      `${window.location.origin}/forms/${user?.short_id}/${form.slug}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const archive = async (form: FormRecord) => {
    try {
      await saveNow({
        ...form,
        status: "archived",
        settings: {
          ...form.settings,
          archivedFromStatus:
            form.status === "published" ? "published" : "draft",
        },
      });
      toast({ title: "Form archived" });
    } catch (error) {
      toast({
        title: "Form was not archived",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const restore = async (form: FormRecord) => {
    try {
      await saveNow({
        ...form,
        status: form.settings.archivedFromStatus || "draft",
      });
      toast({ title: "Form restored" });
    } catch (error) {
      toast({
        title: "Form was not restored",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const collectPublishWarnings = (form: FormRecord) => {
    const live = form.settings.liveSnapshot;
    if (!live) return [];
    const warnings: string[] = [];
    const currentById = new Map(form.fields.map((field) => [field.id, field]));
    live.fields.forEach((oldField) => {
      const current = currentById.get(oldField.id);
      if (!current) {
        const workflowCount = workflows.filter((workflow) => workflow.enabled).length;
        warnings.push(
          workflowCount > 0
            ? `"${oldField.label}" was deleted and ${workflowCount} active ${
                workflowCount === 1 ? "workflow" : "workflows"
              } may depend on its answer.`
            : `"${oldField.label}" was deleted. Existing responses keep the old field under their captured version.`,
        );
        return;
      }
      if (current.type !== oldField.type) {
        warnings.push(
          `"${oldField.label}" changes from ${oldField.type} to ${current.type}, which changes future answer validation.`,
        );
      }
      if (!oldField.required && current.required) {
        warnings.push(
          `"${oldField.label}" becomes required for future respondents.`,
        );
      }
    });
    if (
      form.responseCount > 0 &&
      JSON.stringify(live.payment) !== JSON.stringify(form.settings.payment)
    ) {
      warnings.push(
        `${form.responseCount} existing ${
          form.responseCount === 1 ? "response was" : "responses were"
        } collected before this payment configuration changed.`,
      );
    }
    return warnings;
  };

  const requestPublish = async () => {
    if (!selectedForm) return;
    if (selectedForm.fields.length === 0) {
      toast({
        title: "Add at least one field",
        description: "A form cannot be published with an empty schema.",
        variant: "destructive",
      });
      return;
    }
    if (selectedForm.settings.payment.enabled) {
      const payment = selectedForm.settings.payment;
      if (payment.mode === "fixed" && payment.amount <= 0) {
        toast({
          title: "Set a payment amount",
          description: "A paid form needs an amount greater than zero.",
          variant: "destructive",
        });
        return;
      }
      if (
        payment.mode === "product" &&
        !paymentProducts.some((product) => product.id === payment.productId)
      ) {
        toast({
          title: "Choose an active product",
          description:
            "Select a product from the payment catalog before publishing.",
          variant: "destructive",
        });
        return;
      }
      if (payment.mode === "cart") {
        const cartProductIds = [...new Set(
          selectedForm.fields
            .filter((field) => field.type === "product")
            .flatMap((field) => field.config?.productIds || []),
        )];
        const cartProducts = cartProductIds
          .map((productId) => paymentProducts.find((product) => product.id === productId))
          .filter((product): product is PaymentProduct => Boolean(product));
        if (cartProductIds.length === 0 || cartProducts.length !== cartProductIds.length) {
          toast({
            title: "Add active products",
            description: "A cart checkout needs at least one active catalog product in a Product field.",
            variant: "destructive",
          });
          return;
        }
        if (cartProducts.some((product) => product.billingType !== "one_time")) {
          toast({
            title: "Use one-time products",
            description: "Recurring subscriptions cannot be mixed into a multi-product form cart.",
            variant: "destructive",
          });
          return;
        }
        const currencies = new Set(cartProducts.map((product) => product.currency));
        if (currencies.size !== 1) {
          toast({
            title: "Use one currency",
            description: "Every product in a form cart must use the same currency.",
            variant: "destructive",
          });
          return;
        }
      }
      const selectedPaymentProduct = paymentProducts.find(
        (product) => product.id === payment.productId,
      );
      if (
        payment.mode === "product" &&
        selectedPaymentProduct?.billingType === "recurring" &&
        (payment.provider === "opay" ||
          !paymentProviderConnections.some(
            (connection) => connection.provider !== "opay",
          ))
      ) {
        toast({
          title: "Connect a recurring billing provider",
          description:
            "Recurring products require Stripe, PayPal, or Paystack.",
          variant: "destructive",
        });
        return;
      }
      const hasUsableProvider = paymentProviderConnections.some(
        (connection) =>
          connection.status === "connected" &&
          connection.healthOk &&
          (payment.provider === "workspace" ||
            connection.provider === payment.provider),
      );
      if (!userId || !hasUsableProvider) {
        toast({
          title: "Connect a payment provider",
          description:
            "This paid form needs a healthy merchant account before it can go live.",
          variant: "destructive",
        });
        return;
      }
    }
    if (selectedForm.status === "published") {
      setFormSlugDraft(selectedForm.slug);
      setSlugStatus("available");
      await publish(selectedForm.slug);
      return;
    }
    setFormSlugDraft(selectedForm.slug);
    setSlugStatus("available");
    setPublishWarnings(collectPublishWarnings(selectedForm));
    setPublishOpen(true);
  };

  const publish = useCallback(
    async (slugOverride = formSlugDraft): Promise<boolean> => {
    if (!selectedForm) return false;
    setPublishing(true);
    // A published form keeps its own slug, so rechecking it adds an avoidable
    // database request to every live Update. Slug edits are validated in Form
    // settings before they are saved.
    const slugAvailable =
      selectedForm.status === "published" ||
      (await validateFormSlugNow(selectedForm, slugOverride));
    if (!slugAvailable) {
      setPublishing(false);
      return false;
    }
    const formToPublish = {
      ...selectedForm,
      slug: slugOverride,
    };
    const version = formToPublish.settings.version + 1;
    const snapshot = {
      fields: structuredClone(formToPublish.fields),
      theme: { ...formToPublish.settings.theme },
      payment: { ...formToPublish.settings.payment },
      version,
      title: formToPublish.title,
      description: formToPublish.description,
      slug: formToPublish.slug,
    };
    const versionRecord: FormVersion = {
      id: createId("version"),
      version,
      publishedAt: new Date().toISOString(),
      publishedBy: fullName,
      fields: structuredClone(formToPublish.fields),
      title: formToPublish.title,
      description: formToPublish.description,
    };
    try {
      await saveNow({
        ...formToPublish,
        status: "published",
        settings: {
          ...formToPublish.settings,
          lifecycle: "active",
          version,
          versions: [...formToPublish.settings.versions, versionRecord],
          liveSnapshot: snapshot,
          hasUnpublishedChanges: false,
        },
      });
      void syncFormPaymentProduct(userId!, formToPublish).catch(() => {
        toast({
          title: "Form published",
          description:
            "The form is live, but its catalog listing will be retried on the next save.",
        });
      });
      setPublishOpen(false);
      toast({
        title:
          formToPublish.status === "published"
            ? `Version ${version} is live`
            : "Form published",
        description: "Your unique public URL is ready to share.",
      });
      return true;
    } catch (error) {
      toast({
        title: "Form was not published",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setPublishing(false);
    }
    },
    [
      formSlugDraft,
      fullName,
      saveNow,
      selectedForm,
      toast,
      userId,
      validateFormSlugNow,
    ],
  );

  const saveFormChanges = useCallback(
    () =>
      requiresPublishedUpdate
        ? publish(editingForm?.slug || formSlugDraft)
        : saveCurrentDraft(false),
    [
      editingForm?.slug,
      formSlugDraft,
      publish,
      requiresPublishedUpdate,
      saveCurrentDraft,
    ],
  );

  useEffect(() => {
    if (!onDraftGuardChange) return;
    onDraftGuardChange(
      editingForm
        ? {
            hasUnsavedChanges,
            requiresUpdate: requiresPublishedUpdate,
            saveDraft: () => saveCurrentDraft(false),
            saveChanges: saveFormChanges,
            discardChanges: discardFormChanges,
          }
        : null,
    );
  }, [
    discardFormChanges,
    editingForm,
    hasUnsavedChanges,
    onDraftGuardChange,
    requiresPublishedUpdate,
    saveCurrentDraft,
    saveFormChanges,
  ]);

  const restoreVersion = (version: FormVersion) => {
    if (!selectedForm) return;
    queueFormChange({
      ...selectedForm,
      title: version.title,
      description: version.description,
      fields: structuredClone(version.fields),
      settings: {
        ...selectedForm.settings,
        hasUnpublishedChanges: selectedForm.status === "published",
      },
    });
    toast({
      title: `Version ${version.version} restored to draft`,
      description: "Publish the update when you are ready.",
    });
  };

  const confirmDelete = async () => {
    if (!userId || !deleteTarget || deleteName !== deleteTarget.title) return;
    if (deleteTarget.responseCount > 0 && !deleteResponses) return;
    setDeleting(true);
    try {
      await deleteWorkspaceForm(userId, deleteTarget.id);
      formsRef.current = formsRef.current.filter(
        (form) => form.id !== deleteTarget.id,
      );
      setForms(formsRef.current);
      syncFormQueryCache(formsRef.current);
      clearFormDraft(localStorage, userId, deleteTarget.id);
      if (selectedFormId === deleteTarget.id) {
        setSelectedFormId(
          forms.find((form) => form.id !== deleteTarget.id)?.id || null,
        );
      }
      if (editingFormId === deleteTarget.id) rememberEditingForm(null);
      if (previewFormId === deleteTarget.id) setPreviewFormId(null);
      if (settingsFormId === deleteTarget.id) setSettingsFormId(null);
      setDeleteTarget(null);
      setDeleteName("");
      setDeleteResponses(false);
      toast({ title: "Form deleted" });
    } catch (error) {
      toast({
        title: "Form was not deleted",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const headerTitle =
    editingForm
      ? "Edit form"
      : activeTab === "all"
      ? "All forms"
      : tabs.find((tab) => tab.key === activeTab)?.label || "Forms";

  const closeBuilder = () => {
    runTransition(
      "Returning to forms",
      () => {
        rememberEditingForm(null);
        setSaveState("idle");
        onTabChange("all");
        scrollDashboardToTop("auto");
      },
      260,
    );
  };

  const requestBuilderExit = (onExit: () => void = closeBuilder) => {
    if (hasUnsavedChanges || requiresPublishedUpdate) {
      setPendingBuilderExit(() => onExit);
      return;
    }
    onExit();
  };

  const saveChangesAndExitBuilder = async () => {
    if (!pendingBuilderExit) return;
    setExitSaving(true);
    try {
      const saved = await saveFormChanges();
      if (!saved) return;
      const exit = pendingBuilderExit;
      setPendingBuilderExit(null);
      exit();
    } finally {
      setExitSaving(false);
    }
  };

  const discardChangesAndExitBuilder = async () => {
    if (!pendingBuilderExit) return;
    setExitSaving(true);
    try {
      const discarded = await discardFormChanges();
      if (!discarded) return;
      const exit = pendingBuilderExit;
      setPendingBuilderExit(null);
      exit();
    } finally {
      setExitSaving(false);
    }
  };

  return (
    <div className="relative min-w-0">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          {editingForm ? (
            <button
              type="button"
              onClick={() => requestBuilderExit()}
              className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to all forms
            </button>
          ) : embedded ? null : (
            <p className="text-[11px] font-semibold uppercase text-primary">
              Forms
            </p>
          )}
          {/* Inside a project the page already carries the project's name and
              tabs; a second title would only compete with it. The builder keeps
              its own header either way, so editing still reads correctly. */}
          {embedded && !editingForm ? null : (
            <>
              <h1 className="mt-2 text-[30px] font-semibold leading-tight sm:text-[36px]">
                {headerTitle}
              </h1>
              <p className="mt-2 text-[13px] text-muted-foreground">
                {editingForm
                  ? editingForm.title
                  : "Build, publish, collect, automate, and analyze from one module."}
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editingForm ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => openFormSettings(editingForm)}
              >
                <Settings className="h-4 w-4" />
                Form settings
              </Button>
              {editingForm.status === "published" && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openLiveForm(editingForm)}
                    aria-label="Open live form"
                  >
                    <ExternalLink className="h-4 w-4" />
                    <span className="hidden xl:inline">Open live form</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copyLiveLink(editingForm)}
                    aria-label="Copy live link"
                  >
                    <Link2 className="h-4 w-4" />
                    <span className="hidden xl:inline">Copy live link</span>
                  </Button>
                </>
              )}
              <Button
                type="button"
                onClick={requestPublish}
                disabled={
                  publishing ||
                  (editingForm.status === "published" &&
                    !editingForm.settings.hasUnpublishedChanges)
                }
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {publishing
                  ? editingForm.status === "published"
                    ? "Updating..."
                    : "Publishing..."
                  : editingForm.status === "published"
                  ? "Update"
                  : "Publish"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => openModuleTab("templates")}>
              <Plus className="h-4 w-4" />
              New form
            </Button>
          )}
        </div>
      </div>

      {!editingForm && !embedded && (
        <nav
          className="dashboard-scroll dashboard-scroll-x mt-7 flex overflow-x-auto border-b border-border"
          aria-label="Forms module"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => openModuleTab(tab.key)}
                className={cn(
                  "relative flex h-12 shrink-0 items-center gap-2 px-3 text-[13px] transition-colors sm:px-4",
                  activeTab === tab.key
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                {tab.key === "responses" && selectedForm?.responseCount ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[9px]">
                    {selectedForm.responseCount}
                  </span>
                ) : null}
                {activeTab === tab.key && (
                  <span className="absolute inset-x-3 bottom-0 h-[2px] bg-primary sm:inset-x-4" />
                )}
              </button>
            );
          })}
        </nav>
      )}

      {loadError && (
        <div className="mt-5 flex items-center justify-between gap-4 border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <p className="text-[12px]">The forms workspace is not synced.</p>
          </div>
          <Button type="button" variant="outline" onClick={loadForms}>
            Retry
          </Button>
        </div>
      )}

      <div className="mt-7">
        {editingForm ? (
          <FormBuilder
            key={editingForm.id}
            form={editingForm}
            onChange={queueFormChange}
            onPreview={() => openPreview(editingForm)}
            onRestoreVersion={restoreVersion}
            onSaveDraft={() => void saveCurrentDraft()}
            manualDraftSaving={manualDraftSaving}
            saveState={saveState}
            confirmationPanel={
              <div className="max-w-[920px] py-7">
                <ConfirmationSettingsEditor
                  allowInheritance
                  inherited={modulePreferences.confirmation}
                  value={editingForm.settings.confirmation}
                  onChange={(confirmation) =>
                    queueFormChange({
                      ...editingForm,
                      settings: { ...editingForm.settings, confirmation },
                    })
                  }
                />
              </div>
            }
            contactsPanel={
              <div className="max-w-[920px] py-7">
                <div className="mb-6">
                  <h2 className="text-[18px] font-semibold">Contact lists</h2>
                  <p className="mt-1 max-w-[620px] text-[12px] leading-5 text-muted-foreground">
                    Sync completed responses into CRM audiences and manage the
                    list connection for this form.
                  </p>
                </div>
                <FormListConnector form={editingForm} userId={userId} />
              </div>
            }
            onOpenPaymentProviders={() =>
              requestBuilderExit(() =>
                navigate("/dashboard?tab=payments&section=providers"),
              )
            }
            paymentProducts={paymentProducts}
            onPaymentProductsChange={setPaymentProducts}
            providerConnections={paymentProviderConnections}
            userId={userId || undefined}
          />
        ) : (
          <>
        {activeTab === "templates" && (
          <>
            <div className="mb-5 flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={createBlank}
                disabled={creatingTemplateId !== null}
              >
                {creatingTemplateId === "blank" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Start blank
              </Button>
            </div>
            <TemplateGallery
              creatingTemplateId={creatingTemplateId}
              loading={loading}
              onCreate={useTemplate}
              templates={templates}
            />
          </>
        )}

        {activeTab === "email_templates" && (
          <SharedEmailTemplates module="forms" />
        )}

        {activeTab === "all" && (
          <AllFormsView
            forms={visibleForms}
            loading={loading || Boolean(projectId && !formsHydrated)}
            userId={userId}
            onNew={() => openModuleTab("templates")}
            onEdit={openEditor}
            onEditUrl={openFormSettings}
            onPreview={openPreview}
            onSettings={openFormSettings}
            onOpenLive={openLiveForm}
            onProjectAssigned={handleFormProjectAssigned}
            projectAssignmentsLoading={!formsHydrated}
            onDuplicate={duplicate}
            onLifecycle={updateLifecycle}
            onArchive={archive}
            onRestore={restore}
            onUnpublish={unpublish}
            onCopyLink={copyLiveLink}
            onDelete={(form) => {
              setDeleteTarget(form);
              setDeleteName("");
              setDeleteResponses(false);
            }}
          />
        )}

        {activeTab === "ai" && (
          <AiGeneratorView
            creating={creatingGeneratedForm}
            onCreate={createGeneratedForm}
            templates={templates}
          />
        )}

        {activeTab === "responses" && (
          <ResponsesView
            form={selectedForm}
            forms={visibleForms}
            loading={contextLoading}
            submissions={submissions}
            payments={payments}
            workflows={workflows}
            userId={userId}
            onSelectForm={setSelectedFormId}
            onRefresh={() => loadFormContext(true)}
          />
        )}

        {activeTab === "analytics" && (
          <AnalyticsView
            analytics={workspaceAnalytics}
            forms={visibleForms}
            loading={workspaceAnalyticsLoading}
            onRefresh={() => void loadAnalytics(true)}
            onViewForms={() => openModuleTab("all")}
          />
        )}

        {activeTab === "automations" && (
          <AutomationWorkspace
            form={selectedForm}
            forms={visibleForms}
            workflows={workflows}
            userId={userId}
            onSelectForm={setSelectedFormId}
            onWorkflowsChange={setWorkflows}
          />
        )}

        {activeTab === "settings" && (
          <FormModuleSettingsView
            loading={modulePreferencesLoading}
            preferences={modulePreferences}
            onChange={setModulePreferences}
            onSave={saveModulePreferences}
            saving={moduleSettingsSaving}
          />
        )}
          </>
        )}
      </div>

      <FormTransitionOverlay message={transitionMessage} />

      <Dialog
        open={Boolean(pendingBuilderExit)}
        onOpenChange={(open) => {
          if (!open && !exitSaving) setPendingBuilderExit(null);
        }}
      >
        <DialogContent className="w-[calc(100%-24px)] max-w-[620px] gap-0 overflow-hidden p-0">
          <DialogHeader className="items-center px-6 pb-6 pt-7 text-center sm:px-8 sm:text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-5 w-5" />
            </span>
            <DialogTitle>
              {requiresPublishedUpdate
                ? "Save or discard this update?"
                : "Save changes before leaving?"}
            </DialogTitle>
            <DialogDescription className="max-w-[520px] leading-6">
              {requiresPublishedUpdate
                ? "This published form has changes that are not live yet. Save changes to make the update live, discard changes to restore the last live version, or return to the builder."
                : "This form has unsaved changes. Save them, discard them, or return to the builder."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="grid w-full grid-cols-1 gap-2 border-t border-border p-4 sm:grid-cols-3 sm:flex-none sm:space-x-0 sm:p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingBuilderExit(null)}
              disabled={exitSaving}
              className="w-full min-w-0 justify-center whitespace-normal text-center text-[12px] sm:text-[13px]"
            >
              Return to builder
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void discardChangesAndExitBuilder()}
              disabled={exitSaving}
              className="w-full min-w-0 justify-center whitespace-normal border-destructive/40 text-center text-destructive hover:bg-destructive/10 hover:text-destructive sm:text-[13px]"
            >
              <Trash2 className="h-4 w-4" />
              Discard changes
            </Button>
            <Button
              type="button"
              onClick={() => void saveChangesAndExitBuilder()}
              disabled={exitSaving}
              className="w-full min-w-0 justify-center whitespace-normal text-center text-[12px] sm:text-[13px]"
            >
              {exitSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FormPreviewDialog
        form={previewForm}
        onOpenChange={(open) => {
          if (!open) setPreviewFormId(null);
        }}
      />

      <Dialog
        open={Boolean(settingsForm)}
        onOpenChange={(open) => {
          if (!open && !formSettingsSaving) setSettingsFormId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100%-24px)] max-w-[900px] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-5 pr-14">
            <div className="flex min-w-0 items-center gap-3 text-left">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Settings className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-[18px]">Form settings</DialogTitle>
                <DialogDescription className="mt-1 truncate">
                  {settingsForm?.title}
                </DialogDescription>
              </div>
              {settingsForm && (
                <span
                  className={cn(
                    "ml-auto hidden shrink-0 rounded px-2 py-1 text-[10px] font-medium sm:inline-flex",
                    formStateClasses(formState(settingsForm)),
                  )}
                >
                  {formState(settingsForm)}
                </span>
              )}
            </div>
          </DialogHeader>
          <div className="dashboard-scroll max-h-[calc(90vh-150px)] overflow-y-auto px-6">
            {settingsForm && (
              <FormSettingsView
                form={settingsForm}
                onChange={queueFormChange}
                onSlugChange={updateFormSlugDraft}
                slug={formSlugDraft}
                slugStatus={slugStatus}
              />
            )}
          </div>
          <DialogFooter className="flex-row items-center justify-between border-t border-border px-6 py-4">
            <span className="hidden text-[10px] text-muted-foreground sm:block">
              Changes are saved with this form only.
            </span>
            <div className="flex items-center gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Close
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={saveOpenFormSettings}
                disabled={
                  formSettingsSaving ||
                  slugStatus === "checking" ||
                  slugStatus === "taken" ||
                  slugStatus === "invalid"
                }
              >
                {formSettingsSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save settings
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        onSlugChange={updateFormSlugDraft}
        form={selectedForm}
        slug={formSlugDraft}
        slugStatus={slugStatus}
        warnings={publishWarnings}
        working={publishing}
        onConfirm={publish}
      />

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteTarget(null);
            setDeleteName("");
            setDeleteResponses(false);
          }
        }}
      >
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Delete form</DialogTitle>
            <DialogDescription>
              Archive is safer and reversible. Permanent deletion cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-5 py-2">
              {deleteTarget.responseCount > 0 && (
                <div className="border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-[12px] font-medium">
                    This form has {deleteTarget.responseCount}{" "}
                    {deleteTarget.responseCount === 1 ? "response" : "responses"}.
                  </p>
                  <label className="mt-3 flex items-start gap-3 text-[11px] text-muted-foreground">
                    <Checkbox
                      checked={deleteResponses}
                      onCheckedChange={(checked) =>
                        setDeleteResponses(Boolean(checked))
                      }
                    />
                    <span>
                      I understand that deleting this form also deletes its
                      non-financial response records under the current database policy.
                    </span>
                  </label>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="delete-form-name">
                  Type {deleteTarget.title} to confirm
                </Label>
                <Input
                  id="delete-form-name"
                  value={deleteName}
                  onChange={(event) => setDeleteName(event.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={
                deleting ||
                !deleteTarget ||
                deleteName !== deleteTarget.title ||
                (deleteTarget.responseCount > 0 && !deleteResponses)
              }
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

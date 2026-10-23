/**
 * Campaigns module.
 *
 * A full campaign sender built on the parts the platform already has: the block
 * editor from Forms and Email Templates, the List/Segment model from Contacts,
 * and the provider send path from the Email module. The tabs across the top are
 * the workflow — draft, target, schedule, measure — and every one of them reads
 * and writes the same campaign record.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Bot,
  Check,
  X,
  CalendarClock,
  LayoutDashboard,
  LayoutTemplate,
  Loader2,
  MailCheck,
  Megaphone,
  Palette,
  Plus,
  RefreshCw,
  Send,
  ShieldOff,
  Settings2,
  Target,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  archiveContactCampaign,
  bulkUpdateContactCampaigns,
  completeCampaignBuilder,
  deleteContactCampaign,
  duplicateContactCampaign,
  getCampaignAnalytics,
  getCampaignAudiencePreview,
  getCampaignClickMap,
  getCampaignPerformanceOverview,
  getCampaignSendProgress,
  getCampaignSettings,
  getCampaignWizardIdentities,
  getCampaignWizardReview,
  listCampaignVariants,
  listContactCampaigns,
  listContactLists,
  pauseContactCampaign,
  resumeContactCampaign,
  saveCampaignBuilderState,
  saveCampaignSettings,
  saveCampaignWizardIdentity,
  saveCampaignWizardRecipients,
  saveContactCampaign,
  scheduleCampaignFromWizard,
  sendContactCampaignNow,
  sendCampaignTest,
  type CampaignAudienceMode,
  type CampaignOverviewRange,
  type ContactCampaignBulkAction,
  type ContactCampaignBulkResult,
  type ContactCampaign,
  type ContactCampaignSettings,
} from "@/lib/contacts";
import { getEmailWorkspace } from "@/lib/email";
import { listPaymentProducts } from "@/lib/payments";
import { cn } from "@/lib/utils";
import { readBrandColor } from "@/lib/brand-color";
import { Reveal } from "@/components/shared/transitions";
import { VariableText } from "@/components/ui/variable-text";
import { useOptionalWorkspaceRegion } from "@/contexts/WorkspaceRegionContext";
import { workspaceDateTimeToUtc } from "@/lib/campaign-timezone";
import { subscribeCampaignAnalyticsRealtime } from "@/lib/campaign-realtime";

import { CampaignAiChat, type AiTurn } from "./CampaignAiChat";
import {
  CampaignAnalyticsPanel,
  type CampaignAnalyticsData,
} from "./CampaignAnalyticsPanel";
import {
  CampaignBuilderScreen,
  type CampaignBuilderDraft,
} from "./CampaignBuilderScreen";
import { CampaignOverview } from "./CampaignOverview";
import { type SchedulingState } from "./CampaignSchedulingPanel";
import {
  CampaignSendWizard,
  type WizardStepKey,
} from "./CampaignSendWizard";
import {
  CampaignProgressMeter,
  CampaignSendProgressCard,
} from "./CampaignSendProgress";
import { CampaignSettingsPanel } from "./CampaignSettingsPanel";
import { CampaignSuppressionsPanel } from "./CampaignSuppressionsPanel";
import { CampaignsTable } from "./CampaignsTable";
import {
  CampaignSimpleBuilder,
  type SimpleBuilderDraft,
} from "./CampaignSimpleBuilder";
import { draftCampaign, type CampaignDraft } from "./campaign-ai";
import {
  campaignBlocksPayload,
  campaignDesignFromBlocks,
  campaignSpamReport,
  composeCampaignHtml,
  createCampaignBlock,
  emptyCampaignDesign,
  type CampaignDesign,
} from "./campaign-blocks";
import {
  campaignHasStarted,
  formatCampaignDate,
  hasSent,
  toLocalDateTimeValue,
} from "./campaign-format";
import {
  CampaignCreateFlow,
  type DesignMode,
  type FlowStep,
} from "./CampaignCreateFlow";
import {
  campaignCategoryLabels,
  campaignCategoryOf,
  designFromTemplate,
  type CampaignTemplate,
} from "./campaign-templates";

/**
 * Only the places you return to are tabs. Designing and sending are modes, not
 * destinations: the builder takes the whole screen and the wizard is an ordered
 * flow, so neither belongs in a strip of equal-weight tabs.
 *
 * "Audience" is deliberately absent. It duplicated the Lists and Segments that
 * already live in Contacts; recipients are now picked inside the send flow,
 * reading the same records, so audience data has exactly one home.
 */
export type CampaignTab =
  | "overview"
  | "campaigns"
  | "ai"
  | "analytics"
  | "suppressions"
  | "settings";

const tabs: Array<{ key: CampaignTab; label: string; icon: LucideIcon }> = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "campaigns", label: "All campaigns", icon: Megaphone },
  { key: "ai", label: "AI creator", icon: Bot },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "suppressions", label: "Unsubscribed", icon: ShieldOff },
  { key: "settings", label: "Settings", icon: Settings2 },
];

/** Which full-screen mode, if any, is covering the dashboard. */
/** "simple" is the text-only and custom-HTML builder; "builder" is blocks. */
type CampaignMode = "none" | "flow" | "builder" | "simple" | "wizard";

type CampaignEditorState = {
  id?: string;
  name: string;
  subject: string;
  previewText: string;
  audienceMode: CampaignAudienceMode;
  listIds: string[];
  listId: string;
  excludeListId: string;
  customRecipients: string[];
  category: string;
  design: CampaignDesign;
  aiGenerated: boolean;
};

type WizardAudienceSave = {
  userId: string;
  campaignId: string;
  audienceMode: CampaignAudienceMode;
  listIds: string[];
  customRecipients: string[];
  excludeListId: string | null;
};

type WizardAudienceSaveState = {
  pending: WizardAudienceSave | null;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<boolean> | null;
};

const emptyEditor = (): CampaignEditorState => ({
  name: "",
  subject: "",
  previewText: "",
  audienceMode: "lists",
  listIds: [],
  listId: "",
  excludeListId: "",
  customRecipients: [],
  category: "newsletter",
  design: emptyCampaignDesign(),
  aiGenerated: false,
});

const emptySchedule = (timeZone = "UTC"): SchedulingState => ({
  strategy: "scheduled",
  scheduledAt: toLocalDateTimeValue(
    new Date(Date.now() + 60 * 60 * 1000),
    timeZone,
  ),
  recurrence: "weekly",
  requiresReview: true,
  abEnabled: false,
  abSubject: "",
  abPercentage: 20,
  abMetric: "open",
  abHours: 4,
});

/** Next time today or tomorrow that the clock reaches the given hour. */
const nextOccurrenceOfHour = (hour: number) => {
  const target = new Date();
  target.setMinutes(0, 0, 0);
  target.setHours(hour);
  if (target.getTime() <= Date.now() + 60_000) {
    target.setDate(target.getDate() + 1);
  }
  return target;
};

const editorFromCampaign = (
  campaign: ContactCampaign,
): CampaignEditorState => {
  const listIds = campaign.listIds?.length
    ? campaign.listIds
    : campaign.listId
      ? [campaign.listId]
      : [];
  const audienceMode = campaign.audienceMode === "custom" ? "custom" : "lists";
  return {
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    previewText: campaign.previewText,
    audienceMode,
    listIds,
    listId: listIds[0] || "",
    excludeListId: campaign.excludeListId || "",
    customRecipients: campaign.customRecipients || [],
    category: campaignCategoryOf(campaign.category),
    design: campaignDesignFromBlocks(campaign.blocks).design,
    aiGenerated: campaign.aiGenerated,
  };
};

/**
 * Older campaigns did not persist the authoring surface. Their block envelope
 * still gives us a safe fallback: a single text/html content block plus the
 * compliance footer is the corresponding simple editor; everything else is
 * the drag-and-drop builder.
 */
const authoringModeFromDesign = (design: CampaignDesign): DesignMode => {
  if (design.authoringMode) return design.authoringMode;
  const contentTypes = design.blocks
    .filter((block) => block.type !== "compliance_footer")
    .map((block) => block.type);
  if (contentTypes.length === 1 && contentTypes[0] === "text") {
    return "plain_text";
  }
  if (contentTypes.length === 1 && contentTypes[0] === "html") {
    return "custom_html";
  }
  return "builder";
};

export function CampaignsModule({
  userId,
  initialTab = "overview",
  onTabChange,
}: {
  userId?: string;
  initialTab?: CampaignTab;
  onTabChange?: (tab: CampaignTab) => void;
}) {
  const { timezone: workspaceTimezone } = useOptionalWorkspaceRegion();
  const effectiveWorkspaceTimezone = workspaceTimezone || "UTC";
  const queryClient = useQueryClient();
  const workspaceKey = useMemo(
    () => ["campaigns", userId || "anonymous"],
    [userId],
  );
  // Interval refetches are production recovery paths. Disabling them only in
  // Vitest prevents long integration tests from starting unrelated queries
  // and state transitions halfway through a wizard interaction.
  const pollingEnabled = import.meta.env.MODE !== "test";
  const [overviewRange, setOverviewRange] =
    useState<CampaignOverviewRange>("7d");

  const workspaceQuery = useQuery({
    enabled: Boolean(userId),
    queryKey: workspaceKey,
    queryFn: async () => {
      const [campaigns, lists, settings] = await Promise.all([
        listContactCampaigns(userId!),
        listContactLists(userId!),
        getCampaignSettings(userId!),
      ]);
      return { campaigns, lists, settings };
    },
    refetchOnMount: "always",
    staleTime: 15_000,
    // A sending campaign is a live operational view: refresh its status and
    // counters quickly while it is active, then fall back to a lighter cadence
    // for drafts and completed campaigns.
    refetchInterval: pollingEnabled
      ? (query) =>
          query.state.data?.campaigns?.some(
            (campaign) => campaign.status === "sending",
          )
            ? 2_000
            : 30_000
      : false,
    refetchIntervalInBackground: false,
  });

  const overviewQuery = useQuery({
    enabled: Boolean(userId),
    queryKey: ["campaign-overview", userId || "anonymous", overviewRange],
    queryFn: () => getCampaignPerformanceOverview(userId!, overviewRange),
    // Engagement arrives after delivery, including while the sender is
    // looking at Overview. Refresh the aggregate often enough to show a new
    // open without requiring a tab switch or a full page reload.
    staleTime: 15_000,
    refetchInterval: pollingEnabled ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });

  // Products and sender identities are owned by other modules; the builder and
  // settings tabs read them rather than keeping their own copies.
  const productsQuery = useQuery({
    enabled: Boolean(userId),
    queryKey: ["campaign-products", userId || "anonymous"],
    queryFn: () => listPaymentProducts(userId!),
    staleTime: 120_000,
  });
  const emailQuery = useQuery({
    enabled: Boolean(userId),
    queryKey: ["campaign-email-workspace", userId || "anonymous"],
    queryFn: () => getEmailWorkspace(),
    staleTime: 120_000,
  });

  const campaigns = useMemo(
    () => workspaceQuery.data?.campaigns || [],
    [workspaceQuery.data],
  );
  const analyticsCampaigns = useMemo(
    () =>
      campaigns
        .filter(
          (campaign) =>
            hasSent(campaign) && Number(campaign.stats?.sent || 0) > 0,
        )
        .sort((first, second) => {
          const firstDate = new Date(
            first.sentAt || first.sendStartedAt || first.updatedAt,
          ).getTime();
          const secondDate = new Date(
            second.sentAt || second.sendStartedAt || second.updatedAt,
          ).getTime();
          return secondDate - firstDate;
        }),
    [campaigns],
  );
  const lists = useMemo(
    () => workspaceQuery.data?.lists || [],
    [workspaceQuery.data],
  );

  const [localTab, setLocalTab] = useState<CampaignTab>(initialTab);
  const activeTab = onTabChange ? initialTab : localTab;
  const selectTab = useCallback(
    (tab: CampaignTab) => {
      setLocalTab(tab);
      onTabChange?.(tab);
    },
    [onTabChange],
  );
  const [mode, setMode] = useState<CampaignMode>("none");
  const [wizardStep, setWizardStep] = useState<WizardStepKey>("recipients");
  const [flowStep, setFlowStep] = useState<FlowStep>("settings");
  const [designMode, setDesignMode] = useState<DesignMode>("builder");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [namedByHand, setNamedByHand] = useState(false);
  // Exiting the builder means "back to the flow" only when the flow opened
  // it; editing a campaign from the table returns to the table instead.
  const [builderInFlow, setBuilderInFlow] = useState(false);
  // Remember the mode that has actually been opened during this flow. The
  // design chooser can still switch modes, in which case that new mode starts
  // fresh and the button correctly returns to "Start creating".
  const [builderSessionMode, setBuilderSessionMode] =
    useState<DesignMode | null>(null);
  // Existing campaigns resume the authoring surface they were saved with.
  // New campaigns alone go through the template/design chooser.
  const [resumeSavedAuthoring, setResumeSavedAuthoring] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Set by every edit inside the flow, cleared by every successful save.
  // It is what decides whether closing prompts or just closes.
  const [flowDirty, setFlowDirty] = useState(false);
  const [progressCampaignId, setProgressCampaignId] = useState<string | null>(
    null,
  );
  const [editor, setEditor] = useState<CampaignEditorState>(emptyEditor);
  const [schedule, setSchedule] = useState<SchedulingState>(() =>
    emptySchedule(effectiveWorkspaceTimezone),
  );
  const scheduleTimezoneRef = useRef(effectiveWorkspaceTimezone);
  const wizardAudienceSaveRef = useRef<WizardAudienceSaveState>({
    pending: null,
    timer: null,
    inFlight: null,
  });
  const [analyticsCampaignId, setAnalyticsCampaignId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (activeTab !== "analytics") return;
    if (!analyticsCampaigns.length) {
      if (analyticsCampaignId) setAnalyticsCampaignId(null);
      return;
    }
    if (!analyticsCampaigns.some((campaign) => campaign.id === analyticsCampaignId)) {
      setAnalyticsCampaignId(analyticsCampaigns[0].id);
    }
  }, [activeTab, analyticsCampaignId, analyticsCampaigns]);
  const [settingsDraft, setSettingsDraft] =
    useState<ContactCampaignSettings | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [working, setWorking] = useState(false);
  const [deleting, setDeleting] = useState<ContactCampaign | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState<ContactCampaign[]>([]);
  const [aiTurns, setAiTurns] = useState<AiTurn[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  // The send's own outcome, kept apart from the module-wide `working` flag so
  // the modal can report success or failure in place rather than closing.
  const [testState, setTestState] = useState<
    | { status: "idle" }
    | { status: "sending" }
    | { status: "sent"; recipient: string }
    | { status: "failed"; error: string }
  >({ status: "idle" });
  const [testRecipient, setTestRecipient] = useState("");
  const [resumeCampaign, setResumeCampaign] =
    useState<ContactCampaign | null>(null);
  const [resumeAt, setResumeAt] = useState("");
  const [sendNowCampaign, setSendNowCampaign] =
    useState<ContactCampaign | null>(null);
  const [sendingNowCampaignId, setSendingNowCampaignId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const previousTimezone = scheduleTimezoneRef.current;
    if (previousTimezone === effectiveWorkspaceTimezone) return;
    setSchedule((current) => {
      const instant = workspaceDateTimeToUtc(
        current.scheduledAt,
        previousTimezone,
      );
      return {
        ...current,
        scheduledAt: instant
          ? toLocalDateTimeValue(instant, effectiveWorkspaceTimezone)
          : emptySchedule(effectiveWorkspaceTimezone).scheduledAt,
      };
    });
    scheduleTimezoneRef.current = effectiveWorkspaceTimezone;
  }, [effectiveWorkspaceTimezone]);

  const settings: ContactCampaignSettings = settingsDraft ||
    workspaceQuery.data?.settings || {
      identityId: null,
      mailingAddress: "",
      footerText: "",
      brandVoice: "friendly" as const,
      batchSize: null,
      batchDelaySeconds: null,
    };

  // The audience preview is a live count: it re-runs whenever targeting changes
  // so the number on screen is never a stale list size.
  const audienceQuery = useQuery({
    enabled: Boolean(
      userId &&
        (editor.audienceMode === "custom"
          ? editor.customRecipients.length
          : editor.listIds.length),
    ),
    queryKey: [
      "campaign-audience",
      userId || "anonymous",
      editor.audienceMode,
      editor.listIds,
      editor.excludeListId,
      editor.customRecipients,
    ],
    queryFn: () =>
      getCampaignAudiencePreview(userId!, {
        audienceMode: editor.audienceMode,
        listIds: editor.listIds,
        excludeListId: editor.excludeListId || null,
        customRecipients: editor.customRecipients,
      }),
    staleTime: 10_000,
  });

  const validateCustomAudienceRecipients = useCallback(
    async (recipients: string[]) => {
      if (!userId || !recipients.length) return [];
      const preview = await getCampaignAudiencePreview(userId, {
        audienceMode: "custom",
        customRecipients: recipients,
      });
      return preview.blockedRecipients || [];
    },
    [userId],
  );

  const analyticsQuery = useQuery({
    enabled: Boolean(userId && analyticsCampaignId && activeTab === "analytics"),
    queryKey: ["campaign-analytics", userId || "anonymous", analyticsCampaignId],
    queryFn: async () => {
      const [analytics, clickMap] = await Promise.all([
        getCampaignAnalytics(userId!, analyticsCampaignId!),
        getCampaignClickMap(userId!, analyticsCampaignId!),
      ]);
      return { analytics: analytics as CampaignAnalyticsData, clickMap };
    },
    // Opens and clicks arrive after the message is delivered. Keep the
    // analytics screen live while it is open so the sender does not need to
    // leave and re-enter the campaign to see new activity.
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (
      !userId ||
      !analyticsCampaignId ||
      activeTab !== "analytics" ||
      typeof fetch === "undefined"
    ) {
      return;
    }
    return subscribeCampaignAnalyticsRealtime({
      campaignId: analyticsCampaignId,
      onUpdate: () => {
        void queryClient.invalidateQueries({
          queryKey: ["campaign-analytics", userId, analyticsCampaignId],
        });
        void queryClient.invalidateQueries({ queryKey: workspaceKey });
      },
    });
  }, [
    activeTab,
    analyticsCampaignId,
    queryClient,
    userId,
    workspaceKey,
  ]);

  const variantsQuery = useQuery({
    enabled: Boolean(userId && editor.id),
    queryKey: ["campaign-variants", userId || "anonymous", editor.id],
    queryFn: () => listCampaignVariants(userId!, editor.id!),
    staleTime: 30_000,
  });

  // The wizard's review payload is the single source for what the send will do:
  // audience counts, sender, pacing, and anything blocking it.
  const reviewQuery = useQuery({
    enabled: Boolean(
      userId &&
        editor.id &&
        (mode === "wizard" || (mode === "flow" && flowStep === "review")),
    ),
    queryKey: [
      "campaign-wizard-review",
      userId || "anonymous",
      editor.id,
      editor.audienceMode,
      editor.listIds,
      editor.excludeListId,
      editor.customRecipients,
    ],
    queryFn: () => getCampaignWizardReview(userId!, editor.id!),
    staleTime: 5_000,
  });

  const identitiesQuery = useQuery({
    enabled: Boolean(
      userId && editor.id && (mode === "wizard" || mode === "flow"),
    ),
    queryKey: ["campaign-wizard-identities", userId || "anonymous", editor.id],
    queryFn: () => getCampaignWizardIdentities(userId!, editor.id!),
    staleTime: 30_000,
  });

  // A campaign mid-flight is what the backlog leads with, whether this session
  // started it or it was already running when the module opened.
  const activeSendCampaign = useMemo(
    () =>
      campaigns.find((campaign) => campaign.id === progressCampaignId) ||
      campaigns.find(
        (campaign) =>
          campaign.status === "sending" || campaign.status === "paused",
      ) ||
      null,
    [campaigns, progressCampaignId],
  );

  // Polled while sending so "1,240 of 5,000" moves on its own.
  const progressQuery = useQuery({
    enabled: Boolean(userId && activeSendCampaign),
    queryKey: [
      "campaign-send-progress",
      userId || "anonymous",
      activeSendCampaign?.id,
    ],
    queryFn: () => getCampaignSendProgress(userId!, activeSendCampaign!.id),
    refetchInterval: (query) =>
      query.state.data?.status === "sending" ? 2_000 : false,
    staleTime: 0,
  });

  /**
   * The sender shown in the flow.
   *
   * Read from the Email module rather than stored here: a campaign cannot
   * invent a From address, it can only use one that has already been verified.
   */
  const senderIdentity = useMemo(() => {
    const identities = emailQuery.data?.identities || [];
    if (!identities.length) return null;
    return (
      identities.find((identity) => identity.id === settings.identityId) ||
      identities.find((identity) => identity.isDefault) ||
      identities[0]
    );
  }, [emailQuery.data, settings.identityId]);

  const openCampaign = editor.id
    ? campaigns.find((campaign) => campaign.id === editor.id) || null
    : null;

  // A first-time workspace has no campaign open. Defaulting the audience to the
  // first list keeps the Audience tab useful before anything is saved.
  useEffect(() => {
    if (
      editor.audienceMode === "custom" ||
      editor.listIds.length ||
      editor.listId ||
      !lists.length
    ) {
      return;
    }
    setEditor((current) => ({
      ...current,
      listId: lists[0].id,
      listIds: [lists[0].id],
    }));
  }, [editor.audienceMode, editor.listId, editor.listIds.length, lists]);

  useEffect(() => {
    const variants = variantsQuery.data;
    if (!variants?.length) return;
    const variantB = variants.find((variant) => variant.label === "B");
    if (!variantB) return;
    setSchedule((current) =>
      current.abEnabled
        ? current
        : {
            ...current,
            abEnabled: true,
            abSubject: variantB.subject,
            abPercentage: variantB.testPercentage,
            abMetric: variantB.decisionMetric,
            abHours: variantB.decisionAfterHours,
          },
    );
  }, [variantsQuery.data]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceKey }),
      queryClient.invalidateQueries({
        queryKey: ["campaign-suppressions", userId || "anonymous"],
      }),
      queryClient.invalidateQueries({ queryKey: ["campaign-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["campaign-audience"] }),
      queryClient.invalidateQueries({ queryKey: ["campaign-analytics"] }),
      queryClient.invalidateQueries({ queryKey: ["campaign-variants"] }),
      queryClient.invalidateQueries({ queryKey: ["campaign-send-progress"] }),
      queryClient.invalidateQueries({ queryKey: ["campaign-wizard-review"] }),
      queryClient.invalidateQueries({
        queryKey: ["campaign-wizard-identities"],
      }),
    ]);
  }, [queryClient, userId, workspaceKey]);

  const run = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setWorking(true);
      try {
        const result = await action();
        toast.success(success);
        // Awaited: the step that follows reads the refreshed rows, so letting
        // it render against the pre-action cache shows stale content. The
        // refresh is caught separately, though -- the action has already
        // succeeded by this point, and a failed background refetch must not be
        // reported as the action having failed.
        try {
          await refreshAll();
        } catch {
          // The next read retries it; nothing here is worth interrupting for.
        }
        return result;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "That action did not complete.",
        );
        return null;
      } finally {
        setWorking(false);
      }
    },
    [refreshAll],
  );

  const persistCampaign = useCallback(
    async (state: CampaignEditorState) => {
      if (!userId) return null;
      if (!state.name.trim() || !state.subject.trim()) {
        toast.error("A campaign needs a name and a subject line.");
        return null;
      }
      const listIds =
        state.audienceMode === "lists"
          ? state.listIds.length
            ? state.listIds
            : state.listId
              ? [state.listId]
              : []
          : [];
      if (state.audienceMode === "lists" && !listIds.length) {
        toast.error("Choose at least one audience list.");
        return null;
      }
      if (state.audienceMode === "custom" && !state.customRecipients.length) {
        toast.error("Enter at least one recipient email address.");
        return null;
      }
      const report = campaignSpamReport({
        subject: state.subject,
        previewText: state.previewText,
        design: state.design,
      });
      const savedId = (await run(
        () =>
          saveContactCampaign(userId, {
            id: state.id,
            name: state.name.trim(),
            listId: listIds[0],
            listIds,
            audienceMode: state.audienceMode,
            customRecipients:
              state.audienceMode === "custom" ? state.customRecipients : [],
            excludeListId:
              state.audienceMode === "lists" ? state.excludeListId || null : null,
            subject: state.subject.trim(),
            previewText: state.previewText.trim(),
            htmlBody: composeCampaignHtml(state.design),
            blocks: campaignBlocksPayload(state.design),
            category: state.category,
            spamScore: report.score,
            identityId: settings.identityId,
            aiGenerated: state.aiGenerated,
          }),
        state.id ? "Campaign saved." : "Campaign draft created.",
      )) as string | null;
      if (savedId && !state.id) {
        setEditor((current) => ({ ...current, id: savedId }));
      }
      return savedId;
    },
    [run, settings.identityId, userId],
  );

  /**
   * The starting canvas for a given authoring mode.
   *
   * Plain text and custom HTML are not decorations on the block design — they
   * are different documents, so each opens the builder on its own single block
   * rather than on a layout the writer then has to strip back.
   */
  const blankDesign = useCallback(
    (authoring: DesignMode) => {
      const design = emptyCampaignDesign();
      design.authoringMode = authoring;
      // Anything this workspace sends should open on its own colour rather than
      // the library default.
      design.accent = readBrandColor(design.accent);
      design.typography = { ...design.typography, linkColor: design.accent };
      const footer = {
        ...createCampaignBlock("compliance_footer"),
        mailingAddress: settings.mailingAddress,
      };
      // Both start empty. The block builder's sample copy is a useful starting
      // shape, but in a bare textarea it is just text to delete first, and it
      // would let an untouched draft pass the "written anything?" check.
      if (authoring === "plain_text") {
        design.blocks = [{ ...createCampaignBlock("text"), content: "" }, footer];
        return design;
      }
      if (authoring === "custom_html") {
        design.blocks = [{ ...createCampaignBlock("html"), html: "" }, footer];
        return design;
      }
      design.blocks = [
        createCampaignBlock("heading"),
        createCampaignBlock("text"),
        createCampaignBlock("button"),
        footer,
      ];
      return design;
    },
    [settings.mailingAddress],
  );

  /** The New campaign button. Opens the flow at step one on a clean draft. */
  const startFlow = () => {
    const initialListId = lists[0]?.id || "";
    setEditor({
      ...emptyEditor(),
      listId: initialListId,
      listIds: initialListId ? [initialListId] : [],
      design: blankDesign("builder"),
    });
    setSchedule(emptySchedule(effectiveWorkspaceTimezone));
    setNamedByHand(false);
    setDesignMode("builder");
    setTemplateId(null);
    setFlowStep("settings");
    setBuilderInFlow(false);
    setBuilderSessionMode(null);
    setResumeSavedAuthoring(false);
    setFlowDirty(false);
    setMode("flow");
  };

  /**
   * Choosing a template inside the flow.
   *
   * Anything the writer already typed in step one wins: a template supplies a
   * subject, but it must not overwrite one that was authored deliberately.
   */
  const applyTemplateInFlow = (template: CampaignTemplate | null) => {
    if (!template) {
      setTemplateId(null);
      setEditor((current) => ({ ...current, design: blankDesign(designMode) }));
      return;
    }
    const design = designFromTemplate(template);
    design.authoringMode = "builder";
    if (settings.mailingAddress) {
      design.blocks = design.blocks.map((block) =>
        block.type === "compliance_footer"
          ? { ...block, mailingAddress: settings.mailingAddress }
          : block,
      );
    }
    setTemplateId(template.id);
    setEditor((current) => {
      const subject = current.subject.trim() || template.subject;
      return {
        ...current,
        subject,
        previewText: current.previewText.trim() || template.previewText,
        name: namedByHand ? current.name : subject,
        category: template.category,
        design,
      };
    });
  };

  /** Step two's action: save what exists so far, then open the builder. */
  const openBuilderFromFlow = async () => {
    const design = { ...editor.design, authoringMode: designMode };
    setEditor((current) => ({ ...current, design }));
    const savedId = await persistCampaign({ ...editor, design });
    if (!savedId) return;
    setFlowDirty(false);
    setBuilderInFlow(true);
    setBuilderSessionMode(designMode);
    // Plain text and custom HTML get the same shell without the block palette.
    setMode(designMode === "builder" ? "builder" : "simple");
  };

  /**
   * Start from scratch.
   *
   * Drops the design and returns to the choice of how to make one. Subject,
   * preview line and recipients survive — they are not what was being redone.
   */
  const restartDesign = () => {
    setTemplateId(null);
    setDesignMode("builder");
    setBuilderSessionMode(null);
    setEditor((current) => ({ ...current, design: blankDesign("builder") }));
    setFlowDirty(true);
    setFlowStep("design");
    setMode("flow");
  };

  const applyAiDraft = (draft: CampaignDraft, subject: string) => {
    const design = { ...draft.design, authoringMode: "builder" as const };
    setEditor({
      name: draft.name,
      subject,
      previewText: draft.previewText,
      audienceMode: "lists",
      listIds: [draft.segment?.listId || editor.listId || lists[0]?.id || ""].filter(Boolean),
      listId: draft.segment?.listId || editor.listId || lists[0]?.id || "",
      excludeListId: "",
      customRecipients: [],
      category: draft.category,
      design,
      aiGenerated: true,
    });
    setSchedule({
      ...emptySchedule(effectiveWorkspaceTimezone),
      scheduledAt:
        draft.sendTime.basis === "history"
          ? toLocalDateTimeValue(
              nextOccurrenceOfHour(draft.sendTime.hour),
              effectiveWorkspaceTimezone,
            )
          : emptySchedule(effectiveWorkspaceTimezone).scheduledAt,
    });
    setMode("builder");
    toast.success("Draft opened in the builder for review.");
  };

  /** Reopen saved campaigns through Settings, then their saved authoring surface. */
  const openForEdit = (
    campaign: ContactCampaign,
    options: { continueToBuilder?: boolean } = {},
  ) => {
    const nextEditor = editorFromCampaign(campaign);
    const nextMode = authoringModeFromDesign(nextEditor.design);
    setEditor(nextEditor);
    setDesignMode(nextMode);
    // Existing campaigns already have an internal name. Treat it as explicit
    // so changing the subject in Settings does not silently rename the saved
    // campaign.
    setNamedByHand(true);
    setTemplateId(null);
    setFlowStep("settings");
    setFlowDirty(false);
    setBuilderInFlow(false);
    setBuilderSessionMode(null);
    // Both Edit and Duplicate & edit open a saved campaign. The only time the
    // Settings step should lead to the template chooser is a genuinely new
    // campaign, which is initialized by startFlow above.
    setResumeSavedAuthoring(
      Boolean(campaign.id) || Boolean(options.continueToBuilder),
    );
    setSchedule({
      ...emptySchedule(effectiveWorkspaceTimezone),
      strategy:
        campaign.sendStrategy === "immediate" ? "scheduled" : campaign.sendStrategy,
      scheduledAt: campaign.scheduledAt
        ? toLocalDateTimeValue(
            new Date(campaign.scheduledAt),
            effectiveWorkspaceTimezone,
          )
        : emptySchedule(effectiveWorkspaceTimezone).scheduledAt,
      recurrence: campaign.recurrenceRule === "monthly" ? "monthly" : "weekly",
      requiresReview: campaign.recurrenceRequiresReview,
    });
    setMode("flow");
  };

  /**
   * Sends the test and reports the result inside the modal.
   *
   * Deliberately not routed through `run`: that shows a toast and would let the
   * modal close, which is what made a failed send look like nothing happened.
   */
  const sendTest = async () => {
    if (!userId || !editor.id) {
      setTestState({
        status: "failed",
        error: "Save this campaign first so the test sends its real content.",
      });
      return;
    }
    const recipient = testRecipient.trim();
    setTestState({ status: "sending" });
    try {
      await sendCampaignTest(userId, editor.id, recipient);
      setTestState({ status: "sent", recipient });
    } catch (error) {
      setTestState({
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "That test could not be sent.",
      });
    }
  };

  /**
   * One turn of the AI conversation.
   *
   * The drafting runs locally today; this is the only place a model would be
   * called, so swapping in Gemini is a change to this function rather than to
   * the chat screen.
   */
  const askAi = (prompt: string) => {
    const id = `${Date.now()}`;
    setAiTurns((current) => [
      ...current,
      { id: `${id}-user`, role: "user", text: prompt },
    ]);
    setAiThinking(true);
    // A beat before the reply: an instant answer reads as canned rather than
    // considered, and the delay is where a real request will sit.
    window.setTimeout(() => {
      try {
        const draft = draftCampaign({
          prompt,
          lists,
          openHours: overviewQuery.data?.openHours || [],
          brandVoice: settings.brandVoice,
          mailingAddress: settings.mailingAddress,
        });
        setAiTurns((current) => [
          ...current,
          {
            id: `${id}-reply`,
            role: "assistant",
            text: `Here is a ${
              campaignCategoryLabels[
                draft.category as keyof typeof campaignCategoryLabels
              ]?.toLowerCase() || draft.category
            } campaign${
              draft.segment ? ` aimed at ${draft.segment.listName}` : ""
            }. Pick a subject line and open it in the builder, or tell me what to change.`,
            draft,
          },
        ]);
      } catch (error) {
        setAiTurns((current) => [
          ...current,
          {
            id: `${id}-error`,
            role: "assistant",
            text:
              error instanceof Error
                ? error.message
                : "That draft could not be generated. Try describing the campaign differently.",
          },
        ]);
      } finally {
        setAiThinking(false);
      }
    }, 550);
  };

  const openAnalytics = (campaign: ContactCampaign) => {
    setAnalyticsCampaignId(campaign.id);
    selectTab("analytics");
  };

  const runCampaignBulkAction = async (
    action: ContactCampaignBulkAction,
    selected: ContactCampaign[],
  ) => {
    if (!userId || !selected.length) return;
    const result = (await run(
      () =>
        bulkUpdateContactCampaigns(
          userId,
          selected.map((campaign) => campaign.id),
          action,
        ),
      action === "archive"
        ? "Selected campaigns archived."
        : action === "pause"
          ? "Selected campaigns paused."
          : action === "resume"
            ? "Selected campaigns resumed."
            : "Selected campaigns deleted.",
    )) as ContactCampaignBulkResult | null;
    if (result?.skipped) {
      toast.info(
        `${result.skipped} selected campaign${result.skipped === 1 ? " was" : "s were"} skipped because its status did not allow that action.`,
      );
    }
  };

  /**
   * A paused campaign has two honest resume paths. A campaign that has already
   * dispatched a wave resumes from its next wave immediately; a campaign
   * paused before dispatch gets its original future time back, or asks for a
   * new one when that time has passed.
   */
  const requestResume = (campaign: ContactCampaign) => {
    if (campaignHasStarted(campaign)) {
      setProgressCampaignId(campaign.id);
      void run(
        () => resumeContactCampaign(userId!, campaign.id),
        "Campaign resumed.",
      );
      return;
    }

    const original = campaign.scheduledAt
      ? new Date(campaign.scheduledAt)
      : null;
    const originalIsFuture =
      original && Number.isFinite(original.getTime()) && original.getTime() > Date.now();
    setResumeAt(
      originalIsFuture
        ? toLocalDateTimeValue(original, effectiveWorkspaceTimezone)
        : emptySchedule(effectiveWorkspaceTimezone).scheduledAt,
    );
    setResumeCampaign(campaign);
  };

  /**
   * Save & Continue. The design is persisted, marked ready, and the wizard
   * takes over — there is no separate publish step to find.
   */
  const saveAndContinue = async () => {
    // Persist first so the wizard is always working against stored content,
    // then mark the design finished.
    const savedId = await persistCampaign(editor);
    if (!savedId) return;
    const ready = await run(
      () => completeCampaignBuilder(userId!, savedId),
      "Design saved. Choose who receives it.",
    );
    if (!ready) return;
    setWizardStep("recipients");
    setMode("wizard");
  };

  /**
   * Autosave while designing. Only ever writes the design surface.
   *
   * The saved values are written straight back into the cached campaign list.
   * Without this the list keeps serving its pre-edit copy until it happens to
   * go stale, so reopening a campaign you just saved shows the old design —
   * the work was stored, it was simply never re-read.
   */
  const autosaveBuilder = useCallback(
    async (draft: CampaignBuilderDraft) => {
      if (!userId || !draft.id) return;
      const report = campaignSpamReport({
        subject: draft.subject,
        previewText: draft.previewText,
        design: draft.design,
      });
      const htmlBody = composeCampaignHtml(draft.design);
      const blocks = campaignBlocksPayload(draft.design);
      await saveCampaignBuilderState(userId, draft.id, {
        name: draft.name,
        subject: draft.subject,
        previewText: draft.previewText,
        htmlBody,
        blocks,
        spamScore: report.score,
      });
      queryClient.setQueryData(
        workspaceKey,
        (current: { campaigns: ContactCampaign[] } | undefined) =>
          current
            ? {
                ...current,
                campaigns: current.campaigns.map((campaign) =>
                  campaign.id === draft.id
                    ? {
                        ...campaign,
                        name: draft.name.trim() || campaign.name,
                        subject: draft.subject,
                        previewText: draft.previewText,
                        htmlBody,
                        blocks,
                        spamScore: report.score,
                      }
                    : campaign,
                ),
              }
            : current,
      );
    },
    [queryClient, userId, workspaceKey],
  );

  /** Explicit Save draft handlers keep the editor open, including for a new row. */
  const saveBuilderDraft = useCallback(
    (draft: CampaignBuilderDraft) =>
      persistCampaign({
        ...editor,
        id: draft.id || editor.id,
        name: draft.name,
        subject: draft.subject,
        previewText: draft.previewText,
        design: { ...draft.design, authoringMode: "builder" },
      }),
    [editor, persistCampaign],
  );

  const saveSimpleDraft = useCallback(
    (draft: SimpleBuilderDraft) =>
      persistCampaign({
        ...editor,
        id: draft.id || editor.id,
        name: draft.name,
        subject: draft.subject,
        previewText: draft.previewText,
        design: { ...draft.design, authoringMode: designMode },
      }),
    [designMode, editor, persistCampaign],
  );

  const flushWizardAudienceSave = useCallback(async (): Promise<boolean> => {
    const state = wizardAudienceSaveRef.current;
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    let succeeded = true;
    while (true) {
      if (state.inFlight) {
        succeeded = (await state.inFlight) && succeeded;
        continue;
      }

      const pending = state.pending;
      state.pending = null;
      if (!pending) return succeeded;

      const request = (async () => {
        try {
          await saveCampaignWizardRecipients(pending.userId, pending.campaignId, {
            audienceMode: pending.audienceMode,
            listIds: pending.listIds,
            customRecipients: pending.customRecipients,
            excludeListId: pending.excludeListId,
          });
          await reviewQuery.refetch();
          return true;
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "That audience is not available.",
          );
          return false;
        }
      })();
      state.inFlight = request;
      try {
        succeeded = (await request) && succeeded;
      } finally {
        state.inFlight = null;
      }
    }
  }, [reviewQuery]);

  const applyWizardRecipients = (
    audienceMode: CampaignAudienceMode,
    listIds: string[],
    customRecipients: string[],
    excludeListId: string,
  ) => {
    const listId = listIds[0] || "";
    setEditor((current) => ({
      ...current,
      audienceMode,
      listIds,
      listId,
      customRecipients,
      excludeListId: audienceMode === "lists" ? excludeListId : "",
    }));
    if (
      !userId ||
      !editor.id ||
      (audienceMode === "lists" ? !listIds.length : !customRecipients.length)
    ) {
      return;
    }

    const state = wizardAudienceSaveRef.current;
    state.pending = {
      userId,
      campaignId: editor.id,
      audienceMode,
      listIds: [...listIds],
      customRecipients: [...customRecipients],
      excludeListId:
        audienceMode === "lists" ? excludeListId || null : null,
    };
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      void flushWizardAudienceSave();
    }, 250);
  };

  const saveWizardAudienceBeforeConfirm = async () => {
    if (!(await flushWizardAudienceSave())) {
      return false;
    }
    return true;
  };

  /** Builder → flow. Saves the design and advances to recipients. */
  const saveAndContinueInFlow = async () => {
    const savedId = await persistCampaign(editor);
    if (!savedId) return;
    const ready = await run(
      () => completeCampaignBuilder(userId!, savedId),
      "Design saved. Choose who receives it.",
    );
    if (!ready) return;
    setFlowDirty(false);
    setFlowStep("recipients");
    setMode("flow");
  };

  /** Review step. Persists any late edits, then hands over to the sender. */
  const sendFromFlow = async (strategy: "immediate" | "scheduled") => {
    if (!userId) return;
    const scheduledAt =
      strategy === "immediate"
        ? undefined
        : workspaceDateTimeToUtc(
            schedule.scheduledAt,
            effectiveWorkspaceTimezone,
          )?.toISOString();
    if (strategy !== "immediate" && !scheduledAt) {
      toast.error(
        "Choose a valid future date and time in the workspace time zone.",
      );
      return;
    }
    const savedId = editor.id || (await persistCampaign(editor));
    if (!savedId) return;
    const sent = await run(
      () =>
        scheduleCampaignFromWizard(userId, savedId, {
          strategy,
          scheduledAt,
        }),
      strategy === "immediate" ? "Campaign is sending." : "Campaign scheduled.",
    );
    if (!sent) return;
    setProgressCampaignId(savedId);
    setScheduleOpen(false);
    setMode("none");
    selectTab("campaigns");
  };

  const confirmWizard = async () => {
    if (!userId || !editor.id) return;
    if (!(await saveWizardAudienceBeforeConfirm())) return;
    const scheduledAt =
      schedule.strategy === "immediate"
        ? undefined
        : workspaceDateTimeToUtc(
            schedule.scheduledAt,
            effectiveWorkspaceTimezone,
          )?.toISOString();
    if (schedule.strategy !== "immediate" && !scheduledAt) {
      toast.error(
        "Choose a valid future date and time in the workspace time zone.",
      );
      return;
    }
    const sent = await run(
      () =>
        scheduleCampaignFromWizard(userId, editor.id!, {
          strategy: schedule.strategy,
          scheduledAt,
          recurrenceRule:
            schedule.strategy === "recurring" ? schedule.recurrence : "",
          recurrenceRequiresReview: schedule.requiresReview,
        }),
      schedule.strategy === "immediate"
        ? "Campaign is sending."
        : "Campaign scheduled.",
    );
    if (!sent) return;
    setProgressCampaignId(editor.id);
    setMode("none");
    selectTab("campaigns");
  };

  if (workspaceQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-11 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[340px] rounded-xl" />
      </div>
    );
  }

  if (workspaceQuery.isError) {
    return (
      <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-6 text-center">
        <h2 className="text-[14px] font-semibold text-destructive">
          Campaigns could not be loaded
        </h2>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {workspaceQuery.error instanceof Error
            ? workspaceQuery.error.message
            : "Try again."}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-4"
          onClick={() => void workspaceQuery.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  const filteredCampaigns = campaigns.filter((campaign) => {
    const query = search.trim().toLowerCase();
    return (
      (statusFilter === "all" || campaign.status === statusFilter) &&
      (categoryFilter === "all" ||
        campaignCategoryOf(campaign.category) === categoryFilter) &&
      (!query ||
        [campaign.name, campaign.subject, campaign.listName, campaign.status]
          .join(" ")
          .toLowerCase()
          .includes(query))
    );
  });

  const deliverable = audienceQuery.data?.deliverable || 0;
  const resumeInstant = resumeAt
    ? workspaceDateTimeToUtc(resumeAt, effectiveWorkspaceTimezone)
    : null;
  const resumeIsValid = Boolean(
    resumeInstant && resumeInstant.getTime() > Date.now(),
  );

  /**
   * The send-test dialog, rendered alongside every mode.
   *
   * It used to live only in the dashboard's own return, below the builder's
   * early return — so pressing Send test inside the builder set the state but
   * rendered nothing, and the dialog only appeared once the builder closed.
   */
  const testDialog = (
    <Dialog
      open={testOpen}
      onOpenChange={(open) => {
        if (testState.status === "sending") return;
        setTestOpen(open);
        if (!open) setTestState({ status: "idle" });
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send a test</DialogTitle>
          <DialogDescription>
            The saved version of this campaign is sent through your connected
            provider, so the test inbox gets exactly what recipients will.
          </DialogDescription>
        </DialogHeader>

        {testState.status === "sent" ? (
          <div className="space-y-3 py-3 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <Check className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[13px] font-medium">Test email sent</p>
              <p className="mt-1 break-all text-[11.5px] text-muted-foreground">
                Delivered to {testState.recipient}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 py-2">
            <Label htmlFor="campaign-test-recipient">Send to</Label>
            <Input
              id="campaign-test-recipient"
              type="email"
              value={testRecipient}
              disabled={testState.status === "sending"}
              onChange={(event) => {
                setTestRecipient(event.target.value);
                if (testState.status === "failed") {
                  setTestState({ status: "idle" });
                }
              }}
              placeholder="you@example.com"
            />
            {testState.status === "sending" ? (
              <p
                role="status"
                className="flex items-center gap-2 text-[11.5px] text-muted-foreground"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Sending test email…
              </p>
            ) : null}
            {testState.status === "failed" ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11.5px] text-destructive"
              >
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">{testState.error}</span>
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {testState.status === "sent" ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTestState({ status: "idle" })}
              >
                Send another
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setTestOpen(false);
                  setTestState({ status: "idle" });
                }}
              >
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={testState.status === "sending"}
                onClick={() => setTestOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  testState.status === "sending" ||
                  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testRecipient)
                }
                onClick={() => void sendTest()}
              >
                {testState.status === "sending" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {testState.status === "failed" ? "Try again" : "Send test"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // The builder and the wizard replace the dashboard rather than sitting inside
  // it: designing needs the whole screen, and sending needs one thing at a time.
  if (mode === "builder") {
    return (
      <>
      <CampaignBuilderScreen
        draft={{
          id: editor.id,
          name: editor.name,
          subject: editor.subject,
          previewText: editor.previewText,
          design: editor.design,
        }}
         onDraftChange={(draft) =>
          setEditor((current) => ({
            ...current,
            name: draft.name,
            subject: draft.subject,
            previewText: draft.previewText,
             design: draft.design,
           }))
         }
         onSaveDraft={saveBuilderDraft}
         onAutosave={editor.id ? autosaveBuilder : undefined}
        onExit={() => {
          if (builderInFlow) {
            // Back to the step that opened it, with the design kept.
            setFlowStep("design");
            setMode("flow");
            return;
          }
          setMode("none");
          selectTab("campaigns");
          // Leaving the builder is the moment the list is looked at again, so
          // it refetches rather than trusting the locally patched copy.
          void refreshAll();
        }}
        onSaveAndContinue={() => {
          if (builderInFlow) {
            void saveAndContinueInFlow();
            return;
          }
          void saveAndContinue();
        }}
        onStartOver={builderInFlow ? restartDesign : undefined}
        onSendTest={
          editor.id
            ? () => setTestOpen(true)
            : () =>
                toast.error(
                  "Save this draft first so the test sends the same content recipients will get.",
                )
        }
        mailingAddress={settings.mailingAddress}
        products={productsQuery.data || []}
        continuing={working}
      />
      {testDialog}
      </>
    );
  }

  if (mode === "simple") {
    return (
      <>
        <CampaignSimpleBuilder
          mode={designMode === "custom_html" ? "custom_html" : "plain_text"}
          draft={{
            id: editor.id,
            name: editor.name,
            subject: editor.subject,
            previewText: editor.previewText,
            design: editor.design,
          }}
          onDraftChange={(next) =>
            setEditor((current) => ({
              ...current,
              name: next.name,
              subject: next.subject,
              previewText: next.previewText,
              design: next.design,
            }))
          }
          onExit={() => {
            if (builderInFlow) {
              setFlowStep("design");
              setMode("flow");
              return;
            }
            setMode("none");
            selectTab("campaigns");
            void refreshAll();
          }}
           onSaveDraft={saveSimpleDraft}
          onSaveAndContinue={() => void saveAndContinueInFlow()}
          onStartOver={restartDesign}
          saving={working}
          continuing={working}
        />
        {testDialog}
      </>
    );
  }

  if (mode === "wizard") {
    return (
      <>
      <CampaignSendWizard
        campaignName={editor.name}
        design={editor.design}
        workspaceTimezone={effectiveWorkspaceTimezone}
        lists={lists}
        audienceMode={editor.audienceMode}
        listIds={editor.listIds}
        customRecipients={editor.customRecipients}
        excludeListId={editor.excludeListId}
        onAudienceModeChange={(audienceMode) =>
          void applyWizardRecipients(
            audienceMode,
            audienceMode === "lists" ? editor.listIds : [],
            audienceMode === "custom" ? editor.customRecipients : [],
            audienceMode === "lists" ? editor.excludeListId : "",
          )
        }
        onToggleList={(listId) => {
          const nextListIds = editor.listIds.includes(listId)
            ? editor.listIds.filter((entry) => entry !== listId)
            : [...editor.listIds, listId];
          void applyWizardRecipients(
            "lists",
            nextListIds,
            [],
            nextListIds.includes(editor.excludeListId)
              ? ""
              : editor.excludeListId,
          );
        }}
        onCustomRecipientsChange={(customRecipients) =>
          void applyWizardRecipients("custom", [], customRecipients, "")
        }
        onValidateCustomRecipients={validateCustomAudienceRecipients}
        onExcludeListChange={(excludeListId) =>
          void applyWizardRecipients(
            "lists",
            editor.listIds,
            [],
            excludeListId,
          )
        }
        identities={identitiesQuery.data?.identities || []}
        selectedIdentityId={identitiesQuery.data?.selectedIdentityId || null}
        onIdentityChange={(identityId) => {
          if (!userId || !editor.id) return;
          void run(
            () =>
              saveCampaignWizardIdentity(userId, editor.id!, { identityId }),
            "Sender updated.",
          ).then(() => {
            void identitiesQuery.refetch();
            void reviewQuery.refetch();
          });
        }}
        review={reviewQuery.data || null}
        reviewLoading={reviewQuery.isFetching}
        schedule={{
          strategy: schedule.strategy,
          scheduledAt: schedule.scheduledAt,
          recurrence: schedule.recurrence,
          requiresReview: schedule.requiresReview,
        }}
        onScheduleChange={(next) =>
          setSchedule((current) => ({ ...current, ...next }))
        }
        onClose={() => {
          // Reached from the flow's review step, closing means "back to the
          // flow" — leaving the module entirely would discard where they were.
          if (builderInFlow) {
            setFlowStep("review");
            setMode("flow");
            return;
          }
          setMode("none");
          selectTab("campaigns");
        }}
        onBackToBuilder={() => setMode("builder")}
        onConfirm={() => void confirmWizard()}
        working={working}
        step={wizardStep}
        onStepChange={setWizardStep}
      />
      {testDialog}
      </>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Megaphone className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[.12em]">
              Audience messaging
            </span>
          </div>
          <h2 className="mt-2 text-[22px] font-semibold tracking-tight">
            Campaigns
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">
            Build, target, schedule, and measure marketing email on the same
            block editor, audience model, and send path the rest of the workspace
            uses.
          </p>
        </div>
        {/* No Save draft here. Designing happens in the builder and the create
            flow, and both save their own work — on the list screen the button
            wrote editor state that is not on screen anywhere. */}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={startFlow} disabled={!lists.length}>
            <Plus className="h-4 w-4" />
            New campaign
          </Button>
        </div>
      </header>

      <nav
        className="dashboard-scroll dashboard-scroll-x flex gap-1 overflow-x-auto border-b border-border"
        aria-label="Campaign sections"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectTab(tab.key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-11 shrink-0 items-center gap-2 px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground",
                active && "text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {active ? (
                <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" />
              ) : null}
            </button>
          );
        })}
      </nav>

      {editor.id || editor.name ? (
        <section className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
          <span className="text-[10px] uppercase tracking-[.08em] text-muted-foreground">
            Editing
          </span>
          <span className="text-[12px] font-medium">
            {editor.name || "Untitled campaign"}
          </span>
          {openCampaign ? (
            <Badge variant="outline" className="text-[9px] capitalize">
              {openCampaign.status}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[9px]">
              Unsaved
            </Badge>
          )}
          {editor.aiGenerated ? (
            <Badge variant="outline" className="text-[9px] uppercase">
              AI draft
            </Badge>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-[10px]"
            onClick={() => {
              setEditor(emptyEditor());
              setSchedule(emptySchedule(effectiveWorkspaceTimezone));
            }}
          >
            Close
          </Button>
        </section>
      ) : null}

      {/* Keyed on the tab so switching plays an entrance rather than snapping.
          space-y-5 moves onto the wrapper, which is now the single child. */}
      <Reveal motionKey={activeTab} className="space-y-5">
      {activeTab === "overview" ? (
        <CampaignOverview
          campaigns={campaigns}
          overview={overviewQuery.data}
          range={overviewRange}
          onRangeChange={setOverviewRange}
          sendProgress={progressQuery.data}
          workspaceTimezone={effectiveWorkspaceTimezone}
          working={working}
          onOpenAnalytics={openAnalytics}
          onPause={(campaign) =>
            void run(
              () => pauseContactCampaign(userId!, campaign.id),
              "Campaign paused. Queued messages were cancelled.",
            )
          }
          onResume={requestResume}
        />
      ) : null}

      {activeTab === "campaigns" && activeSendCampaign ? (
        <CampaignSendProgressCard
          campaignName={activeSendCampaign.name}
          progress={progressQuery.data}
          loading={progressQuery.isLoading}
          working={working}
          onPause={() =>
            void run(
              () => pauseContactCampaign(userId!, activeSendCampaign.id),
              "Campaign paused. Waves still waiting were stopped.",
            )
          }
          onResume={() =>
            requestResume(activeSendCampaign)
          }
        />
      ) : null}

      {activeTab === "campaigns" ? (
        campaigns.length ? (
          <CampaignsTable
            campaigns={filteredCampaigns}
            sendProgress={progressQuery.data}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            onSearchChange={setSearch}
            onStatusFilterChange={setStatusFilter}
            search={search}
            statusFilter={statusFilter}
            workspaceTimezone={effectiveWorkspaceTimezone}
            working={working}
            onEdit={openForEdit}
            onOpenAnalytics={openAnalytics}
            onBulkArchive={(selected) =>
              void runCampaignBulkAction("archive", selected)
            }
            onBulkDelete={(selected) => setBulkDeleting(selected)}
            onBulkPause={(selected) =>
              void runCampaignBulkAction("pause", selected)
            }
            onBulkResume={(selected) =>
              void runCampaignBulkAction("resume", selected)
            }
            onDuplicate={(campaign) =>
              void run(
                () => duplicateContactCampaign(userId!, campaign.id),
                `"${campaign.name}" duplicated as a new draft.`,
              )
            }
            onDuplicateAndEdit={(campaign) => {
              // Reusing a finished campaign: copy it, then open the copy so the
              // next send starts from the design that already worked.
              void run(
                () => duplicateContactCampaign(userId!, campaign.id),
                `"${campaign.name}" duplicated. Opening the copy.`,
              ).then((duplicateId) => {
                if (typeof duplicateId !== "string") return;
                openForEdit({
                  ...campaign,
                  id: duplicateId,
                  name: `${campaign.name} copy`,
                  status: "draft",
                  sentAt: null,
                  scheduledAt: null,
                }, { continueToBuilder: true });
              });
            }}
            onSendTest={(campaign) => {
              setEditor(editorFromCampaign(campaign));
              setTestOpen(true);
            }}
            onDelete={setDeleting}
            onArchive={(campaign) =>
              void run(
                () => archiveContactCampaign(userId!, campaign.id),
                "Campaign archived. Its analytics stay available.",
              )
            }
            onPause={(campaign) =>
              void run(
                () => pauseContactCampaign(userId!, campaign.id),
                "Campaign paused. Queued messages were cancelled.",
              )
            }
            onResume={(campaign) => {
              requestResume(campaign);
            }}
            onSendNow={setSendNowCampaign}
            sendNowCampaignId={sendingNowCampaignId}
          />
        ) : (
          <div className="flex min-h-[340px] flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Send className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-[14px] font-semibold">No campaigns yet</h3>
            <p className="mt-2 max-w-md text-[11px] leading-5 text-muted-foreground">
              {lists.length
                ? "Start from a template, describe one to the AI creator, or build from a blank canvas."
                : "Create a list or segment under CRM → Contacts before building your first campaign."}
            </p>
            {lists.length ? (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button type="button" onClick={startFlow}>
                  <LayoutTemplate className="h-4 w-4" />
                  Browse templates
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => selectTab("ai")}
                >
                  <Bot className="h-4 w-4" />
                  Use the AI creator
                </Button>
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {activeTab === "ai" ? (
        <CampaignAiChat
          turns={aiTurns}
          thinking={aiThinking}
          onSend={askAi}
          onApply={applyAiDraft}
          onReset={() => setAiTurns([])}
        />
      ) : null}

      {activeTab === "analytics" ? (
        <div className="space-y-5">
          <section className="flex flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[.08em] text-primary">
                Performance workspace
              </p>
              <h2 className="mt-1 text-[18px] font-semibold tracking-tight">
                Campaign analytics
              </h2>
              <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted-foreground">
                Choose any campaign that has sent to compare delivery, opens,
                clicks, and deliverability in one live view.
              </p>
            </div>
            <div className="flex w-full items-end gap-2 sm:w-auto">
              <div className="min-w-0 flex-1 sm:w-[330px] sm:flex-none">
                <Label
                  htmlFor="campaign-analytics-selector"
                  className="mb-1.5 block text-[10px] font-medium text-muted-foreground"
                >
                  Sent campaign
                </Label>
                <Select
                  value={analyticsCampaignId || "__none"}
                  onValueChange={(value) => {
                    if (value !== "__none") setAnalyticsCampaignId(value);
                  }}
                >
                  <SelectTrigger
                    id="campaign-analytics-selector"
                    aria-label="Select a sent campaign"
                    className="h-9 text-[11px]"
                  >
                    <SelectValue placeholder="Select a sent campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    {analyticsCampaigns.length ? (
                      analyticsCampaigns.map((campaign) => (
                        <SelectItem key={campaign.id} value={campaign.id}>
                          {campaign.name} · {Number(campaign.stats?.sent || 0).toLocaleString()} sent · {formatCampaignDate(campaign.sentAt || campaign.sendStartedAt || campaign.updatedAt)}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__none" disabled>
                        No sent campaigns yet
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="Refresh campaign analytics"
                title="Refresh analytics"
                disabled={!analyticsCampaignId || analyticsQuery.isFetching}
                onClick={() => void analyticsQuery.refetch()}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    analyticsQuery.isFetching && "animate-spin",
                  )}
                />
              </Button>
            </div>
          </section>

          {analyticsCampaignId ? (
            <CampaignAnalyticsPanel
              analytics={analyticsQuery.data?.analytics}
              clickMap={analyticsQuery.data?.clickMap || []}
              loading={analyticsQuery.isLoading}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border py-14 text-center text-[11px] text-muted-foreground">
              Send a campaign to unlock its analytics here.
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "suppressions" ? (
        userId ? (
          <CampaignSuppressionsPanel userId={userId} />
        ) : (
          <div className="rounded-xl border border-dashed border-border py-14 text-center text-[11px] text-muted-foreground">
            Sign in to view workspace suppressions.
          </div>
        )
      ) : null}

      {activeTab === "settings" ? (
        <CampaignSettingsPanel
          identities={emailQuery.data?.identities || []}
          settings={settings}
          suppressionCount={emailQuery.data?.overview.suppressions || 0}
          working={working}
          onChange={(patch) =>
            setSettingsDraft({ ...settings, ...patch })
          }
          onSave={() =>
            void run(async () => {
              await saveCampaignSettings(userId!, settings);
              setSettingsDraft(null);
            }, "Campaign settings saved.")
          }
        />
      ) : null}

      <Dialog
        open={Boolean(resumeCampaign)}
        onOpenChange={(open) => {
          if (!open && !working) setResumeCampaign(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resume campaign</DialogTitle>
            <DialogDescription>
              This campaign was paused before its first message was sent. Keep
              its original send time if it is still ahead, or choose a new time
              below. Nothing will be sent until you confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="resume-campaign-at">Send date and time</Label>
            <Input
              id="resume-campaign-at"
              type="datetime-local"
              value={resumeAt}
              min={toLocalDateTimeValue(
                new Date(Date.now() + 60_000),
                effectiveWorkspaceTimezone,
              )}
              disabled={working}
              onChange={(event) => setResumeAt(event.target.value)}
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              Workspace time zone: {effectiveWorkspaceTimezone.replace("_", " ")}
            </p>
            {resumeAt && !resumeIsValid ? (
              <p className="text-[10px] text-destructive" role="alert">
                Choose a future date and time.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={() => setResumeCampaign(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={working || !resumeIsValid || !resumeCampaign}
              onClick={async () => {
                if (!resumeCampaign || !resumeInstant || !resumeIsValid) return;
                const campaignId = resumeCampaign.id;
                const result = await run(
                  () =>
                    resumeContactCampaign(
                      userId!,
                      campaignId,
                      resumeInstant.toISOString(),
                    ),
                  "Campaign resumed and scheduled.",
                );
                if (result === null) return;
                setProgressCampaignId(campaignId);
                setResumeCampaign(null);
              }}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Resume campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(sendNowCampaign)}
        onOpenChange={(open) => {
          if (!open && !working) setSendNowCampaign(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send this campaign now?</DialogTitle>
            <DialogDescription>
              {sendNowCampaign
                ? `This will replace the scheduled time for "${sendNowCampaign.name}" and start sending to its current audience immediately.`
                : "The campaign will start sending immediately."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-900 dark:text-amber-200">
            Sending starts immediately, and messages already sent can’t be
            undone.
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={() => setSendNowCampaign(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={working || !sendNowCampaign}
              onClick={async () => {
                if (!sendNowCampaign || !userId) return;
                const campaignId = sendNowCampaign.id;
                setSendingNowCampaignId(campaignId);
                setSendNowCampaign(null);
                const result = await run(
                  () => sendContactCampaignNow(userId, campaignId),
                  "Campaign is sending now.",
                );
                if (result !== null) setProgressCampaignId(campaignId);
                setSendingNowCampaignId(null);
              }}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {working ? "Sending..." : "Send campaign now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !working) setDeleting(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this campaign?</DialogTitle>
            <DialogDescription>
              {deleting?.name} and all of its campaign history, including
              analytics, will be permanently removed. A provider-accepted email
              cannot be recalled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={working}
              onClick={async () => {
                if (!deleting) return;
                const removedId = deleting.id;
                await run(
                  () => deleteContactCampaign(userId!, removedId),
                  "Campaign deleted.",
                );
                if (editor.id === removedId) setEditor(emptyEditor());
                setDeleting(null);
              }}
            >
              {working ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Delete campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkDeleting.length > 0}
        onOpenChange={(open) => {
          if (!open && !working) setBulkDeleting([]);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete selected campaigns?</DialogTitle>
            <DialogDescription>
              This will permanently remove all {bulkDeleting.length} selected
              campaign{bulkDeleting.length === 1 ? "" : "s"}, including sent
              history and analytics. Pending campaign work will be cancelled;
              provider-accepted emails cannot be recalled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={() => setBulkDeleting([])}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={working}
              onClick={async () => {
                const selected = bulkDeleting;
                if (!userId || !selected.length) return;
                const result = (await run(
                  () =>
                    bulkUpdateContactCampaigns(
                      userId,
                      selected.map((campaign) => campaign.id),
                      "delete",
                    ),
                  "Selected campaigns deleted where allowed.",
                )) as ContactCampaignBulkResult | null;
                if (result === null) return;
                if (result.skipped) {
                  toast.info(
                    `${result.skipped} selected campaign${result.skipped === 1 ? " was" : "s were"} kept because it could not be deleted.`,
                  );
                }
                setBulkDeleting([]);
              }}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </Reveal>

      {testDialog}

      <CampaignCreateFlow
        open={mode === "flow"}
        step={flowStep}
        onStepChange={setFlowStep}
        draft={{
          name: editor.name,
          subject: editor.subject,
          previewText: editor.previewText,
          namedByHand,
        }}
        onDraftChange={(next) => {
          setFlowDirty(true);
          setNamedByHand(next.namedByHand);
          setEditor((current) => ({
            ...current,
            name: next.name,
            subject: next.subject,
            previewText: next.previewText,
          }));
        }}
        identity={senderIdentity}
        identityLoading={emailQuery.isLoading}
        onManageSender={() => {
          window.location.assign("/dashboard?tab=emails&section=identity");
        }}
        designMode={designMode}
        onDesignModeChange={(next) => {
          if (next === designMode) return;
          setFlowDirty(true);
          setDesignMode(next);
          // Every switch replaces the canvas, in both directions: a template's
          // blocks mean nothing in a plain-text send, and an HTML block means
          // nothing in the block builder. Leaving the old one behind is how you
          // end up in the builder editing a canvas it cannot edit.
          setTemplateId(null);
          setEditor((current) => ({ ...current, design: blankDesign(next) }));
        }}
        onSettingsContinue={
          resumeSavedAuthoring ? () => void openBuilderFromFlow() : undefined
        }
        selectedTemplateId={templateId}
        onSelectTemplate={(template) => {
          setFlowDirty(true);
          applyTemplateInFlow(template);
        }}
        design={editor.design}
        hasExistingDesign={Boolean(editor.id)}
        hasBuilderSession={builderSessionMode === designMode}
        onOpenBuilder={() => void openBuilderFromFlow()}
        lists={lists}
        audienceMode={editor.audienceMode}
        listIds={editor.listIds}
        customRecipients={editor.customRecipients}
        excludeListId={editor.excludeListId}
        onAudienceModeChange={(audienceMode) => {
          setFlowDirty(true);
          setEditor((current) => ({
            ...current,
            audienceMode,
            excludeListId: audienceMode === "lists" ? current.excludeListId : "",
          }));
        }}
        onToggleList={(listId) => {
          setFlowDirty(true);
          setEditor((current) => {
            const listIds = current.listIds.includes(listId)
              ? current.listIds.filter((entry) => entry !== listId)
              : [...current.listIds, listId];
            return {
              ...current,
              listIds,
              listId: listIds[0] || "",
              excludeListId: listIds.includes(current.excludeListId)
                ? ""
                : current.excludeListId,
            };
          });
        }}
        onCustomRecipientsChange={(customRecipients) => {
          setFlowDirty(true);
          setEditor((current) => ({ ...current, customRecipients }));
        }}
        onValidateCustomRecipients={validateCustomAudienceRecipients}
        onExcludeChange={(excludeListId) => {
          setFlowDirty(true);
          setEditor((current) => ({ ...current, excludeListId }));
        }}
        audienceCount={audienceQuery.data?.deliverable ?? null}
        audienceLoading={audienceQuery.isFetching}
        review={reviewQuery.data || null}
        reviewLoading={reviewQuery.isFetching}
        onSendTest={
          editor.id
            ? () => setTestOpen(true)
            : () =>
                toast.error(
                  "Save this draft first so the test sends the same content recipients will get.",
                )
        }
        onRecipientsContinue={async () => {
          const savedId = await persistCampaign(editor);
          if (!savedId) return false;
          setFlowDirty(false);
          return true;
        }}
        onSendNow={() => void sendFromFlow("immediate")}
        onSchedule={() => setScheduleOpen(true)}
        onAdvanced={() => {
          // The long-form wizard owns A/B, recurrence and per-timezone sends.
          // It opens at its own first step rather than jumping to timing: it is
          // a complete alternative path, not a panel bolted onto this one.
          void persistCampaign(editor).then((savedId) => {
            if (!savedId) return;
            setFlowDirty(false);
            setWizardStep("recipients");
            setMode("wizard");
          });
        }}
        dirty={flowDirty}
        onFinishLater={({ save }) => {
          const leave = () => {
            setFlowDirty(false);
            setMode("none");
            selectTab("campaigns");
            void refreshAll();
          };
          if (!save) {
            leave();
            return;
          }
          // Saving can fail — a missing subject, a dropped connection — so the
          // flow only closes once the draft is actually stored.
          void persistCampaign(editor).then((savedId) => {
            if (savedId) leave();
          });
        }}
        working={working}
      />

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Schedule this campaign</DialogTitle>
            <DialogDescription>
              It will be queued and sent automatically at the time you pick. Times
              are in the workspace time zone: {effectiveWorkspaceTimezone}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="flow-schedule-at" className="text-[12px]">
              Send at
            </Label>
            <Input
              id="flow-schedule-at"
              type="datetime-local"
              value={schedule.scheduledAt}
              min={toLocalDateTimeValue(new Date(), effectiveWorkspaceTimezone)}
              onChange={(event) =>
                setSchedule((current) => ({
                  ...current,
                  scheduledAt: event.target.value,
                }))
              }
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={() => setScheduleOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={working || !schedule.scheduledAt}
              onClick={() => void sendFromFlow("scheduled")}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Schedule campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

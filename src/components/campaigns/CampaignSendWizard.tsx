/**
 * The campaign send wizard.
 *
 * Reached from Save & Continue in the full-screen builder. The old flat
 * Audience/Scheduling tabs held the same data, but as five unrelated screens
 * you jumped between; here it is one ordered flow that matches how a campaign
 * is actually put together — design it, then decide who gets it and when.
 *
 * Recipients come live from the CRM's own Lists and Segments. There is no
 * second copy of audience data in this module.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarClock,
  Check,
  Clock,
  Loader2,
  Mail,
  Send,
  Users,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  CampaignAudienceMode,
  CampaignWizardIdentity,
  CampaignWizardReview,
  ContactListRecord,
} from "@/lib/contacts";
import { toWorkspaceDateTimeValue } from "@/lib/campaign-timezone";
import { cn } from "@/lib/utils";

import { CampaignPreview } from "./CampaignPreview";
import { CampaignAudiencePicker } from "./CampaignAudiencePicker";
import type {
  CampaignDesign,
  CampaignPreviewDevice,
  CampaignPreviewTheme,
} from "./campaign-blocks";

const NO_EXCLUSION = "__none__";

const steps = [
  { key: "recipients", label: "Recipients", icon: Users },
  { key: "identity", label: "Sender", icon: Mail },
  { key: "review", label: "Review", icon: Check },
  { key: "schedule", label: "Timing", icon: CalendarClock },
  { key: "confirm", label: "Confirm", icon: Send },
] as const;

export type WizardStepKey = (typeof steps)[number]["key"];

export type WizardSchedule = {
  strategy: "immediate" | "scheduled" | "timezone_optimized" | "recurring";
  scheduledAt: string;
  recurrence: "weekly" | "monthly";
  requiresReview: boolean;
};

function StepRail({ active }: { active: WizardStepKey }) {
  const activeIndex = steps.findIndex((step) => step.key === active);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Send steps">
      {steps.map((step, index) => {
        const done = index < activeIndex;
        const current = index === activeIndex;
        return (
          <li key={step.key} className="flex items-center gap-1.5">
            <span
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                current
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {done ? (
                <Check className="h-3 w-3" />
              ) : (
                <step.icon className="h-3 w-3" />
              )}
              {step.label}
            </span>
            {index < steps.length - 1 ? (
              <span className="h-px w-3 bg-border" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function AudienceBreakdown({
  audience,
}: {
  audience: NonNullable<CampaignWizardReview["audience"]>;
}) {
  // Deductions are held as positive magnitudes and signed at render time: a
  // zero would otherwise print as "-0", which reads like a defect.
  const audienceLabel =
    audience.audienceMode === "custom"
      ? "Everyone in the custom email audience"
      : `Everyone in ${audience.listName}`;
  const rows: Array<{ label: string; value: number; deduction?: boolean }> = [
    { label: audienceLabel, value: audience.totalInList },
    ...(audience.excludeListName
      ? [
          {
            label: `Also in ${audience.excludeListName}`,
            value: audience.excluded,
            deduction: true,
          },
        ]
      : []),
    { label: "Unsubscribed", value: audience.unsubscribed, deduction: true },
    {
      label: "Suppressed after a bounce or complaint",
      value: audience.suppressed,
      deduction: true,
    },
    {
      label: "No email address on file",
      value: audience.missingEmail,
      deduction: true,
    },
  ];
  return (
    <div className="rounded-lg border border-border">
      <dl className="divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 px-3.5 py-2"
          >
            <dt className="text-[11.5px] text-muted-foreground">{row.label}</dt>
            <dd
              className={cn(
                "text-[12px] font-medium tabular-nums",
                row.deduction ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {row.deduction && row.value > 0 ? "−" : ""}
              {row.value.toLocaleString()}
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 bg-muted/40 px-3.5 py-2.5">
          <dt className="text-[12px] font-semibold">Will receive this</dt>
          <dd className="text-[15px] font-semibold tabular-nums text-primary">
            {audience.deliverable.toLocaleString()}
          </dd>
        </div>
      </dl>
      {/* Names, not just a number: seeing who is actually in the list is how
          someone catches having picked the wrong one. */}
      {audience.sample?.length ? (
        <div className="border-t border-border px-3.5 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
            {audience.audienceMode === "custom"
              ? "Recipient preview"
              : "Who is in these lists"}
          </p>
          <ul className="space-y-1.5">
            {audience.sample.map((contact) => (
              <li
                key={contact.id}
                className="flex items-center gap-2.5 text-[11.5px]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold uppercase text-muted-foreground">
                  {(contact.name || contact.email).slice(0, 2)}
                </span>
                <span className="min-w-0 truncate">
                  {contact.name ? (
                    <>
                      <span className="font-medium">{contact.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {contact.email}
                      </span>
                    </>
                  ) : (
                    contact.email
                  )}
                </span>
              </li>
            ))}
          </ul>
          {audience.deliverable > audience.sample.length ? (
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              and {(audience.deliverable - audience.sample.length).toLocaleString()}{" "}
              more
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CampaignSendWizard({
  campaignName,
  design,
  workspaceTimezone,
  lists,
  audienceMode,
  listIds,
  customRecipients,
  excludeListId,
  onAudienceModeChange,
  onToggleList,
  onCustomRecipientsChange,
  onValidateCustomRecipients,
  onExcludeListChange,
  identities,
  selectedIdentityId,
  onIdentityChange,
  review,
  reviewLoading,
  schedule,
  onScheduleChange,
  onClose,
  onBackToBuilder,
  onConfirm,
  working,
  step,
  onStepChange,
}: {
  campaignName: string;
  design: CampaignDesign;
  workspaceTimezone: string;
  lists: ContactListRecord[];
  audienceMode: CampaignAudienceMode;
  listIds: string[];
  customRecipients: string[];
  excludeListId: string;
  onAudienceModeChange: (mode: CampaignAudienceMode) => void;
  onToggleList: (listId: string) => void;
  onCustomRecipientsChange: (recipients: string[]) => void;
  onValidateCustomRecipients: (recipients: string[]) => Promise<string[]>;
  onExcludeListChange: (value: string) => void;
  identities: CampaignWizardIdentity[];
  selectedIdentityId: string | null;
  onIdentityChange: (id: string) => void;
  review: CampaignWizardReview | null;
  reviewLoading: boolean;
  schedule: WizardSchedule;
  onScheduleChange: (schedule: WizardSchedule) => void;
  onClose: () => void;
  onBackToBuilder: () => void;
  onConfirm: () => void;
  working: boolean;
  step: WizardStepKey;
  onStepChange: (step: WizardStepKey) => void;
}) {
  const [previewDevice, setPreviewDevice] =
    useState<CampaignPreviewDevice>("desktop");
  const [previewTheme, setPreviewTheme] =
    useState<CampaignPreviewTheme>("light");

  const stepIndex = steps.findIndex((entry) => entry.key === step);
  const identity = useMemo(
    () => identities.find((entry) => entry.id === selectedIdentityId) || null,
    [identities, selectedIdentityId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !working) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, working]);

  const audience = review?.audience || null;
  const pacing = review?.pacing || null;
  const canAdvance = () => {
    if (step === "recipients") {
      return Boolean(
        !reviewLoading &&
          audience &&
          audience.deliverable > 0 &&
          (audienceMode === "lists"
            ? listIds.length > 0
            : customRecipients.length > 0),
      );
    }
    if (step === "identity") return Boolean(selectedIdentityId && identity && identity.senderReady !== false && identity.verified !== false);
    if (step === "review") return Boolean(review?.canSend);
    if (step === "schedule") {
      return schedule.strategy === "immediate" || Boolean(schedule.scheduledAt);
    }
    return true;
  };

  const goBack = () => {
    if (stepIndex <= 0) {
      onBackToBuilder();
      return;
    }
    onStepChange(steps[stepIndex - 1].key);
  };

  const goNext = () => {
    if (stepIndex >= steps.length - 1) return;
    onStepChange(steps[stepIndex + 1].key);
  };

  return (
    // Same frame as the builder it follows: a large centred workspace rather
    // than a second, differently-shaped full-screen takeover.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-2 backdrop-blur-xs sm:p-4 lg:p-6">
      <div
        role="region"
        aria-label="Campaign send wizard"
        className="flex h-full max-h-[min(940px,100%)] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl"
      >
      {/* Back lives once, in the footer beside Continue, where the flow's
          forward and backward moves belong together. */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">
            {campaignName || "Untitled campaign"}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Step {stepIndex + 1} of {steps.length}
          </p>
        </div>
        <StepRail active={step} />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label="Close the send wizard"
          onClick={onClose}
          disabled={working}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* The campaign itself stays on screen through every step, so decisions
          about who gets it and when are made while looking at what they get. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <aside
          role="region"
          aria-label="Campaign preview"
          className="dashboard-scroll hidden min-h-0 overflow-y-auto border-r border-border bg-muted/30 px-4 py-6 lg:block"
        >
          <div className="mx-auto w-fit">
            <CampaignPreview
              design={design}
              width={
                previewDevice === "mobile"
                  ? 360
                  : previewDevice === "tablet"
                    ? 480
                    : 600
              }
              breakpoint={previewDevice}
            />
          </div>
        </aside>

        <div className="dashboard-scroll min-h-0 overflow-y-auto bg-muted/20 px-4 py-6">
        <div className="mx-auto w-full max-w-[640px] space-y-5">
          {step === "recipients" ? (
            <section className="space-y-4 rounded-xl border border-border bg-card p-5">
              <div>
                <h2 className="text-[15px] font-semibold">Who receives this</h2>
                <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
                  Choose multiple CRM lists or enter a private set of email
                  addresses. List membership is resolved when the campaign is
                  queued.
                </p>
              </div>

              <CampaignAudiencePicker
                mode={audienceMode}
                lists={lists}
                selectedListIds={listIds}
                customRecipients={customRecipients}
                onModeChange={onAudienceModeChange}
                onToggleList={onToggleList}
                onCustomRecipientsChange={onCustomRecipientsChange}
                onValidateCustomRecipients={onValidateCustomRecipients}
              />

              {audienceMode === "lists" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="wizard-exclude-visible">Exclude (optional)</Label>
                  <Select
                    value={excludeListId || NO_EXCLUSION}
                    onValueChange={(value) =>
                      onExcludeListChange(value === NO_EXCLUSION ? "" : value)
                    }
                  >
                    <SelectTrigger id="wizard-exclude-visible">
                      <SelectValue placeholder="No exclusions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_EXCLUSION}>No exclusions</SelectItem>
                      {lists
                        .filter((list) => !listIds.includes(list.id))
                        .map((list) => (
                          <SelectItem key={list.id} value={list.id}>
                            {list.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {reviewLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : audience ? (
                <AudienceBreakdown audience={audience} />
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3.5 py-6 text-center text-[11.5px] text-muted-foreground">
                  Choose an audience to see how many contacts will receive this.
                </p>
              )}
            </section>
          ) : null}

          {step === "identity" ? (
            <section className="space-y-4 rounded-xl border border-border bg-card p-5">
              <div>
                <h2 className="text-[15px] font-semibold">Who it comes from</h2>
                <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
                  This is the name and address recipients see in their inbox.
                </p>
              </div>

              {identities.length ? (
                <div className="space-y-2">
                  {identities.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => onIdentityChange(entry.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
                        entry.id === selectedIdentityId
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/50",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium">
                          {entry.senderName}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {entry.senderEmail || "Managed sender is not configured yet"}
                        </span>
                        <span className="mt-1 block text-[10px] text-muted-foreground">
                          {entry.sendingMode === "custom" ? `Custom domain${entry.customDomain ? ` · ${entry.customDomain}` : ""}` : "MaxForm Managed Sending"}
                          {entry.replyTo ? ` · Reply-to ${entry.replyTo}` : ""}
                        </span>
                      </span>
                      <Badge variant="outline" className={cn("shrink-0 text-[9px]", entry.senderReady !== false && entry.verified !== false ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 text-amber-700 dark:text-amber-300")}>
                        {entry.senderReady !== false && entry.verified !== false ? "Ready" : "Needs setup"}
                      </Badge>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
                  <p className="text-[11.5px] leading-5 text-muted-foreground">
                    This workspace has no sender identity yet. Configure it in
                    Email settings once, then every campaign and transactional
                    message will use the same controlled sender.
                  </p>
                  <p className="text-[11px] font-medium text-primary">Open Settings → Email → Identity to configure the workspace sender.</p>
                </div>
              )}
            </section>
          ) : null}

          {step === "review" ? (
            <section className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-[15px] font-semibold">
                  Everything before it goes
                </h2>
                <dl className="mt-4 divide-y divide-border">
                  {[
                    ["Subject", review?.campaign.subject || "Not set"],
                    ["Preheader", review?.campaign.previewText || "Not set"],
                    [
                      "From",
                      identity
                        ? `${identity.senderName} <${identity.senderEmail}>`
                        : "No sender chosen",
                    ],
                    [
                      "Audience",
                      audience
                        ? audience.audienceMode === "custom"
                          ? `${audience.deliverable.toLocaleString()} of ${audience.totalInList.toLocaleString()} custom email addresses`
                          : `${audience.deliverable.toLocaleString()} of ${audience.totalInList.toLocaleString()} in ${audience.listName}`
                        : "0 recipients",
                    ],
                    [
                      "Sending pace",
                      pacing
                        ? `${pacing.batchCount.toLocaleString()} ${
                            pacing.batchCount === 1 ? "wave" : "waves"
                          } of ${pacing.batchSize.toLocaleString()} · ${pacing.summary}`
                        : "Not calculated yet",
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex flex-wrap items-baseline justify-between gap-2 py-2.5"
                    >
                      <dt className="text-[11px] uppercase tracking-[.06em] text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="max-w-[60%] text-right text-[12.5px]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>

                {review?.blockers.length ? (
                  <ul className="mt-4 space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                    {review.blockers.map((blocker) => (
                      <li
                        key={blocker}
                        className="flex items-start gap-2 text-[11px] leading-5"
                      >
                        <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        {blocker}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold">Final preview</h3>
                  <div className="flex gap-1.5">
                    <div className="flex rounded-md border border-border p-0.5">
                      {(["desktop", "tablet", "mobile"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setPreviewDevice(value)}
                          aria-pressed={previewDevice === value}
                          className={cn(
                            "rounded px-2 py-1 text-[10px] capitalize",
                            previewDevice === value
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    <div className="flex rounded-md border border-border p-0.5">
                      {(["light", "dark"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setPreviewTheme(value)}
                          aria-pressed={previewTheme === value}
                          className={cn(
                            "rounded px-2 py-1 text-[10px] capitalize",
                            previewTheme === value
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={cn(
                    "rounded-lg p-4",
                    previewTheme === "dark" ? "bg-[#111318]" : "bg-muted/30",
                  )}
                >
                  <div className="mx-auto w-fit">
                    <CampaignPreview
                      design={design}
                      width={
                        previewDevice === "mobile"
                          ? 360
                          : previewDevice === "tablet"
                            ? 480
                            : 600
                      }
                      breakpoint={previewDevice}
                    />
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {step === "schedule" ? (
            <section className="space-y-4 rounded-xl border border-border bg-card p-5">
              <div>
                <h2 className="text-[15px] font-semibold">When it goes</h2>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["immediate", "Send now", "Starts sending straight away."],
                    [
                      "scheduled",
                      "Schedule",
                      "Goes out at a date and time you pick.",
                    ],
                    [
                      "timezone_optimized",
                      "Timezone-optimized",
                      "Each contact gets it at that hour in their own timezone.",
                    ],
                    [
                      "recurring",
                      "Recurring",
                      "Repeats on a schedule until you stop it.",
                    ],
                  ] as const
                ).map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      onScheduleChange({ ...schedule, strategy: value })
                    }
                    className={cn(
                      "rounded-lg border p-3.5 text-left transition-colors",
                      schedule.strategy === value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50",
                    )}
                  >
                    <span className="block text-[12.5px] font-medium">
                      {label}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-4 text-muted-foreground">
                      {description}
                    </span>
                  </button>
                ))}
              </div>

              {schedule.strategy !== "immediate" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="wizard-scheduled-at">Date and time</Label>
                  <Input
                    id="wizard-scheduled-at"
                    type="datetime-local"
                    min={toWorkspaceDateTimeValue(
                      new Date(Date.now() + 60_000),
                      workspaceTimezone,
                    )}
                    value={schedule.scheduledAt}
                    onChange={(event) =>
                      onScheduleChange({
                        ...schedule,
                        scheduledAt: event.target.value,
                      })
                    }
                  />
                  <p className="text-[10.5px] leading-4 text-muted-foreground">
                    This time uses the workspace time zone: {workspaceTimezone}.
                  </p>
                </div>
              ) : null}

              {schedule.strategy === "recurring" ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-3">
                  <div>
                    <p className="text-[12px] font-medium">
                      Review each run before it sends
                    </p>
                    <p className="text-[10.5px] text-muted-foreground">
                      A recurring campaign holds for approval by default.
                    </p>
                  </div>
                  <Switch
                    checked={schedule.requiresReview}
                    onCheckedChange={(checked) =>
                      onScheduleChange({ ...schedule, requiresReview: checked })
                    }
                  />
                </div>
              ) : null}

              {/* The pacing is explained here rather than hidden: the user is
                  told what will happen and how long it takes before they
                  commit. */}
              {pacing ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-[11.5px] leading-5">
                    This campaign sends in waves to protect deliverability —{" "}
                    {pacing.batchCount.toLocaleString()}{" "}
                    {pacing.batchCount === 1 ? "wave" : "waves"} of up to{" "}
                    {pacing.batchSize.toLocaleString()}, spaced{" "}
                    {pacing.batchDelaySeconds}s apart to stay inside what{" "}
                    {pacing.provider} accepts. Most of it will be delivered in{" "}
                    <span className="font-medium">{pacing.summary}</span>.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          {step === "confirm" ? (
            <section className="space-y-4 rounded-xl border border-border bg-card p-6 text-center">
              <Send className="mx-auto h-8 w-8 text-primary" />
              <h2 className="text-[16px] font-semibold">
                {schedule.strategy === "immediate"
                  ? "Send this campaign?"
                  : "Schedule this campaign?"}
              </h2>
              <p className="mx-auto max-w-[440px] text-[12px] leading-5 text-muted-foreground">
                {audience
                  ? audience.audienceMode === "custom"
                    ? `${audience.deliverable.toLocaleString()} ${
                        audience.deliverable === 1 ? "recipient" : "recipients"
                      } from the custom email audience will receive this`
                    : `${audience.deliverable.toLocaleString()} ${
                        audience.deliverable === 1 ? "contact" : "contacts"
                      } in ${audience.listName} will receive this`
                  : "This campaign will be sent"}
                {identity ? ` from ${identity.senderName}` : ""}
                {pacing ? `, over ${pacing.summary}` : ""}.
              </p>
              {review && !review.canSend ? (
                <p className="text-[11.5px] text-amber-600">
                  {review.blockers[0]}
                </p>
              ) : null}
              <Button
                type="button"
                size="lg"
                onClick={onConfirm}
                disabled={working || !review?.canSend}
              >
                {working ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {schedule.strategy === "immediate"
                  ? "Send campaign"
                  : "Schedule campaign"}
              </Button>
            </section>
          ) : null}
        </div>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-4 py-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={goBack}
          disabled={working}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {stepIndex === 0 ? "Back to design" : "Back"}
        </Button>
        {step === "confirm" ? (
          <span className="text-[11px] text-muted-foreground">
            Nothing sends until you press the button above.
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={goNext}
            disabled={!canAdvance() || working || reviewLoading}
          >
            Continue
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </footer>
      </div>
    </div>
  );
}

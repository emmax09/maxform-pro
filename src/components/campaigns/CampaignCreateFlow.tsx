/**
 * The campaign creation flow.
 *
 * One ordered modal instead of a tab strip: settings, design, recipients, then
 * review. It sits over the dashboard at builder size with the page greyed
 * behind it, so the flow reads as a task you are inside rather than a place you
 * navigated to.
 *
 * Two things are deliberately read-only here. The sender comes from the Email
 * module's identity — a campaign cannot invent a From address that has not been
 * verified — and recipients come from the CRM's own Lists. Neither is copied
 * into this module.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  Check,
  ChevronRight,
  Code2,
  Eye,
  FileText,
  LayoutTemplate,
  Loader2,
  Mail,
  MousePointerClick,
  Pencil,
  Search,
  Send,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EmailIdentity } from "@/lib/email";
import type {
  CampaignAudienceMode,
  CampaignWizardReview,
  ContactListRecord,
} from "@/lib/contacts";
import { cn } from "@/lib/utils";
import { Reveal, StageLoader } from "@/components/shared/transitions";
import { useStagedTransition } from "@/hooks/use-staged-transition";

import { CampaignPreview, CampaignThumbnail } from "./CampaignPreview";
import { CampaignAudiencePicker } from "./CampaignAudiencePicker";
import { campaignListRecipientCount } from "./campaign-audience-utils";
import { campaignPlainText, type CampaignDesign } from "./campaign-blocks";
import {
  campaignCategoryLabels,
  campaignCategoryOrder,
  campaignTemplates,
  designFromTemplate,
  type CampaignCategory,
  type CampaignTemplate,
} from "./campaign-templates";

export type FlowStep = "settings" | "design" | "recipients" | "review";

/** How the design will be authored. Blank and template both open the builder. */
export type DesignMode = "builder" | "plain_text" | "custom_html";

export type FlowDraft = {
  name: string;
  subject: string;
  previewText: string;
  /** True once the name has been set by hand, so it stops tracking the subject. */
  namedByHand: boolean;
};

const steps: Array<{ key: FlowStep; label: string }> = [
  { key: "settings", label: "Settings" },
  { key: "design", label: "Design" },
  { key: "recipients", label: "Recipients" },
  { key: "review", label: "Review and send" },
];

/** Merge tags the composer can drop into a subject or preview line. */
const mergeFields = [
  { token: "{{first_name}}", label: "First name" },
  { token: "{{last_name}}", label: "Last name" },
  { token: "{{full_name}}", label: "Full name" },
  { token: "{{email}}", label: "Email address" },
  { token: "{{company}}", label: "Company" },
];

const MIN_NAME_LENGTH = 4;

/* ------------------------------------------------------------------- chrome */

function StepRail({
  active,
  furthest,
  onJump,
}: {
  active: FlowStep;
  furthest: number;
  onJump: (step: FlowStep) => void;
}) {
  const activeIndex = steps.findIndex((step) => step.key === active);
  return (
    <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
      {steps.map((step, index) => {
        const done = index < activeIndex;
        const current = index === activeIndex;
        // Only ground already covered is clickable; jumping ahead would skip
        // the validation each step performs on the way out.
        const reachable = index <= furthest;
        return (
          <li key={step.key} className="flex items-center">
            <button
              type="button"
              disabled={!reachable || current}
              onClick={() => onJump(step.key)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full px-2 py-1 text-[12.5px] font-medium transition-colors",
                current
                  ? "text-foreground"
                  : reachable
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/50",
                reachable && !current && "cursor-pointer",
              )}
            >
              <span
                // The filled states take the exact workspace colour; the text
                // on them is white either way, so no contrast adjustment is
                // needed and an approximation would just look wrong beside the
                // rest of the workspace branding.
                style={
                  done || current
                    ? {
                        borderColor: "var(--brand)",
                        ...(done ? { backgroundColor: "var(--brand)" } : null),
                      }
                    : undefined
                }
                className={cn(
                  "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[9px]",
                  done
                    ? "text-primary-foreground"
                    : current
                      ? "text-primary"
                      : "border-muted-foreground/35",
                )}
              >
                {done ? <Check className="h-2.5 w-2.5" /> : null}
              </span>
              {step.label}
            </button>
            {index < steps.length - 1 ? (
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40"
                aria-hidden="true"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function FieldMenu({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Custom fields
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[190px]">
        <DropdownMenuLabel className="text-[11px]">
          Insert a personalisation
        </DropdownMenuLabel>
        {mergeFields.map((field) => (
          <DropdownMenuItem
            key={field.token}
            className="text-[12px]"
            onSelect={() => onInsert(field.token)}
          >
            {field.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{title}</h3>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ step 1 */

function SettingsStep({
  draft,
  onDraftChange,
  identity,
  identityLoading,
  onManageSender,
}: {
  draft: FlowDraft;
  onDraftChange: (draft: FlowDraft) => void;
  identity: EmailIdentity | null;
  identityLoading: boolean;
  onManageSender: () => void;
}) {
  const [showName, setShowName] = useState(draft.namedByHand);
  const subjectRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLInputElement>(null);

  const insertInto = (
    field: "subject" | "previewText",
    element: HTMLInputElement | null,
    token: string,
  ) => {
    const current = draft[field];
    const at = element?.selectionStart ?? current.length;
    const next = `${current.slice(0, at)}${token}${current.slice(at)}`;
    onDraftChange({ ...draft, [field]: next });
    // Put the caret after what was just inserted rather than at the end, so a
    // second insert lands where the writer is looking.
    window.requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const senderName = identity?.senderName || "";
  const senderEmail = identity?.senderEmail || "";
  const nameTooShort = senderName.trim().length > 0 && senderName.trim().length < MIN_NAME_LENGTH;

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <h2 className="text-[26px] font-semibold tracking-tight">Campaign settings</h2>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Panel
            title="Campaign details"
            action={
              !showName ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-[11.5px]"
                  onClick={() => setShowName(true)}
                >
                  Set custom campaign name
                </Button>
              ) : null
            }
          >
            <div className="space-y-4">
              {showName ? (
                <div className="space-y-1.5">
                  <Label htmlFor="flow-name" className="text-[12px]">
                    Campaign name
                  </Label>
                  <Input
                    id="flow-name"
                    value={draft.name}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        name: event.target.value,
                        namedByHand: true,
                      })
                    }
                    placeholder="Spring sale — segment A"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Internal only. Recipients never see this.
                  </p>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="flow-subject" className="text-[12px]">
                  Email subject
                </Label>
                <div className="relative">
                  <Input
                    id="flow-subject"
                    ref={subjectRef}
                    value={draft.subject}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        subject: event.target.value,
                        name: draft.namedByHand ? draft.name : event.target.value,
                      })
                    }
                    placeholder="Up to 60% off!"
                    className="pr-[110px]"
                  />
                  <FieldMenu
                    onInsert={(token) => insertInto("subject", subjectRef.current, token)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="flow-preview" className="text-[12px]">
                  Email preview text
                </Label>
                <div className="relative">
                  <Input
                    id="flow-preview"
                    ref={previewRef}
                    value={draft.previewText}
                    onChange={(event) =>
                      onDraftChange({ ...draft, previewText: event.target.value })
                    }
                    placeholder="Our summer sale is now live!"
                    className="pr-[110px]"
                  />
                  <FieldMenu
                    onInsert={(token) =>
                      insertInto("previewText", previewRef.current, token)
                    }
                  />
                </div>
              </div>

              {!draft.previewText.trim() ? (
                <p className="flex items-start gap-2 text-[11.5px] text-muted-foreground">
                  <MousePointerClick className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>
                    <span className="font-medium text-foreground">Tip:</span> preview
                    text is the line after your subject in the inbox. Without it the
                    client picks its own — usually your first sentence.
                  </span>
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Sender details"
            action={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-[11.5px]"
                onClick={onManageSender}
              >
                Manage in Email
              </Button>
            }
          >
            {identityLoading ? (
              <div className="flex items-center gap-2 py-4 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading your sender identity…
              </div>
            ) : identity ? (
              <div className="space-y-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-[12px]">From name</Label>
                    <div
                      className={cn(
                        "flex h-10 items-center rounded-md border bg-muted/40 px-3 text-[13px]",
                        nameTooShort ? "border-destructive" : "border-border",
                      )}
                    >
                      {senderName || "Not set"}
                    </div>
                    {nameTooShort ? (
                      <p className="text-[11px] text-destructive">
                        From name must be at least {MIN_NAME_LENGTH} characters.
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[12px]">Sender email address</Label>
                    <div className="flex h-10 items-center truncate rounded-md border border-border bg-muted/40 px-3 text-[13px]">
                      {senderEmail || "Not set"}
                    </div>
                  </div>
                </div>
                <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {identity.senderReady ? (
                    <>
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Verified identity, pulled from Email → Settings.
                    </>
                  ) : (
                    <>
                      <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
                      This identity is not verified yet, so the send will be blocked.
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-5 text-center">
                <Mail className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-[12.5px] font-medium">No sender identity yet</p>
                <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-5 text-muted-foreground">
                  Campaigns send from a verified address. Add one in the Email module
                  and it will appear here automatically.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3 h-8 text-[11.5px]"
                  onClick={onManageSender}
                >
                  Set up a sender
                </Button>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Inbox preview" className="self-start">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2">
              {["bg-destructive/40", "bg-amber-400/50", "bg-emerald-500/40"].map(
                (tone) => (
                  <span key={tone} className={cn("h-2 w-2 rounded-full", tone)} />
                ),
              )}
            </div>
            <div className="divide-y divide-border">
              <div className="flex items-center gap-3 bg-primary/4 px-3 py-3">
                <span className="h-3.5 w-3.5 shrink-0 rounded-[3px] border border-muted-foreground/40" />
                <span className="w-[110px] shrink-0 truncate text-[12px] font-semibold">
                  {senderName || "Your sender"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px]">
                  <span className="font-medium">{draft.subject || "Your subject line"}</span>
                  {draft.previewText ? (
                    <span className="text-muted-foreground"> - {draft.previewText}</span>
                  ) : null}
                </span>
              </div>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-3 px-3 py-3">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-[3px] border border-muted-foreground/25" />
                  <span className="h-2 w-[80px] shrink-0 rounded-full bg-muted" />
                  <span
                    className="h-2 rounded-full bg-muted"
                    style={{ width: `${58 - row * 9}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
            Roughly how your campaign lands in a crowded inbox. The subject and the
            preview line are the whole pitch — most people decide here.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ step 2 */

const designModes: Array<{
  key: DesignMode;
  label: string;
  icon: typeof LayoutTemplate;
  note: string;
}> = [
  {
    key: "builder",
    label: "Drag and drop builder",
    icon: LayoutTemplate,
    note: "Start from a finished template and edit every block.",
  },
  {
    key: "plain_text",
    label: "Plain text email",
    icon: FileText,
    note: "No layout, no images — often the best open rate for a personal note.",
  },
  {
    key: "custom_html",
    label: "Custom HTML email",
    icon: Code2,
    note: "Paste your own HTML and keep full control of the markup.",
  },
];

function DesignStep({
  mode,
  onModeChange,
  selectedTemplateId,
  onSelectTemplate,
  hasExistingDesign,
}: {
  mode: DesignMode;
  onModeChange: (mode: DesignMode) => void;
  selectedTemplateId: string | null;
  onSelectTemplate: (template: CampaignTemplate | null) => void;
  hasExistingDesign: boolean;
}) {
  const [category, setCategory] = useState<CampaignCategory | "all">("all");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return campaignTemplates.filter(
      (template) =>
        (category === "all" || template.category === category) &&
        (!query ||
          `${template.name} ${template.description} ${template.subject}`
            .toLowerCase()
            .includes(query)),
    );
  }, [category, search]);

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <h2 className="text-[26px] font-semibold tracking-tight">Design your email</h2>
      <p className="mt-1.5 max-w-3xl text-[12.5px] leading-5 text-muted-foreground">
        Start with a premade template to edit in the drag and drop builder, send a
        text-only note, or code your own design.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {designModes.map((option) => {
          const Icon = option.icon;
          const active = mode === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onModeChange(option.key)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-[12.5px] font-medium transition-colors",
                active
                  ? "border-primary bg-primary/6 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {option.label}
            </button>
          );
        })}
      </div>

      {mode === "builder" ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h3 className="text-[13.5px] font-semibold">
              Choose a template to start editing in the drag and drop builder
            </h3>
          </div>
          <div className="grid gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="border-b border-border p-4 lg:border-b-0 lg:border-r">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find template by name"
                  aria-label="Search campaign templates"
                  className="h-9 pl-9 text-[12px]"
                />
              </div>
              <nav className="mt-3 space-y-0.5" aria-label="Template categories">
                {(["all", ...campaignCategoryOrder] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCategory(value)}
                    className={cn(
                      "w-full rounded-md px-3 py-2 text-left text-[12px] transition-colors",
                      category === value
                        ? "bg-primary/8 font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {value === "all" ? "All templates" : campaignCategoryLabels[value]}
                  </button>
                ))}
              </nav>
            </aside>

            <div className="dashboard-scroll max-h-[calc(100vh-380px)] min-h-[320px] overflow-y-auto p-4">
              {visible.length ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => onSelectTemplate(null)}
                    className={cn(
                      "group flex flex-col overflow-hidden rounded-xl border text-left transition-all",
                      selectedTemplateId === null
                        ? "border-primary ring-2 ring-primary/25"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <span className="flex h-[210px] items-center justify-center bg-muted/40">
                      <span className="flex flex-col items-center gap-2 text-muted-foreground">
                        <LayoutTemplate className="h-8 w-8" />
                        <span className="text-[11px]">Start from scratch</span>
                      </span>
                    </span>
                    <span className="border-t border-border px-3 py-2.5 text-[12px] font-medium">
                      Blank template
                    </span>
                  </button>

                  {visible.map((template) => {
                    const active = selectedTemplateId === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => onSelectTemplate(template)}
                        aria-pressed={active}
                        className={cn(
                          "group flex flex-col overflow-hidden rounded-xl border text-left transition-all",
                          active
                            ? "border-primary ring-2 ring-primary/25"
                            : "border-border hover:border-primary/40 hover:shadow-md",
                        )}
                      >
                        <span className="relative block h-[210px] overflow-hidden bg-muted/30">
                          <CampaignThumbnail
                            design={designFromTemplate(template)}
                            className="h-full w-full"
                          />
                          {active ? (
                            <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="h-3 w-3" />
                            </span>
                          ) : null}
                        </span>
                        <span className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
                          <span className="truncate text-[12px] font-medium">
                            {template.name}
                          </span>
                          <Badge
                            variant="outline"
                            className="shrink-0 border-border/70 text-[9px] text-muted-foreground"
                          >
                            {campaignCategoryLabels[template.category]}
                          </Badge>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border py-14 text-center text-[11.5px] text-muted-foreground">
                  No template matches that search.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <section className="mt-4 rounded-xl border border-border bg-card p-8 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {mode === "plain_text" ? (
              <FileText className="h-5 w-5" />
            ) : (
              <Code2 className="h-5 w-5" />
            )}
          </span>
          <h3 className="mt-3 text-[14px] font-semibold">
            {mode === "plain_text" ? "Plain text email" : "Custom HTML email"}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-5 text-muted-foreground">
            {mode === "plain_text"
              ? "Start creating opens a full-width writing editor — no blocks, with type settings for links, body text and headings down the side."
              : "Start creating opens your markup beside a live preview, so you can see what each change does before it is sent."}
          </p>
          <p className="mt-4 text-[11.5px] text-muted-foreground">
            Personalisation still works — insert it from the Variable menu.
          </p>
        </section>
      )}

      {hasExistingDesign ? (
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          This campaign already has a design. Continue to keep it, or pick a template
          to replace it.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ step 3 */

function LegacyRecipientsStep({
  lists,
  listId,
  excludeListId,
  onListChange,
  onExcludeChange,
  audienceCount,
  audienceLoading,
}: {
  lists: ContactListRecord[];
  listId: string;
  excludeListId: string;
  onListChange: (listId: string) => void;
  onExcludeChange: (listId: string) => void;
  audienceCount: number | null;
  audienceLoading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sortBySize, setSortBySize] = useState(false);
  const [excluding, setExcluding] = useState(Boolean(excludeListId));

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = lists.filter(
      (list) => !query || list.name.toLowerCase().includes(query),
    );
    return sortBySize
      ? [...filtered].sort(
          (a, b) =>
            campaignListRecipientCount(b) - campaignListRecipientCount(a),
        )
      : filtered;
  }, [lists, search, sortBySize]);

  return (
    <div className="mx-auto w-full max-w-[1000px]">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[26px] font-semibold tracking-tight">
          Selected recipients:
        </h2>
        <span className="text-[26px] font-semibold tracking-tight text-primary">
          {audienceLoading ? (
            <Loader2 className="mb-1 inline h-5 w-5 animate-spin" />
          ) : (
            (audienceCount ?? 0).toLocaleString()
          )}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] text-muted-foreground">
        Lists come from CRM → Contacts. A campaign sends to one list, minus anyone in
        the list you exclude.
      </p>

      <section className="mt-5 rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h3 className="text-[13px] font-semibold">Send to this list</h3>
          <div className="flex items-center gap-2">
            <div className="relative w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find by name"
                aria-label="Search lists"
                className="h-9 pl-9 text-[12px]"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 text-[11.5px]"
              onClick={() => setSortBySize((current) => !current)}
              aria-pressed={sortBySize}
            >
              {sortBySize ? "Largest first" : "Sort"}
            </Button>
          </div>
        </div>

        {visible.length ? (
          <ul className="divide-y divide-border">
            {visible.map((list) => {
              const selected = list.id === listId;
              const isExcluded = list.id === excludeListId;
              return (
                <li key={list.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={isExcluded}
                    onClick={() => onListChange(list.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
                      isExcluded
                        ? "cursor-not-allowed opacity-45"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                        selected
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {selected ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">
                        {list.name}
                      </span>
                      {list.description ? (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {list.description}
                        </span>
                      ) : null}
                    </span>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-border/70 text-[9px] text-muted-foreground"
                    >
                      {list.listType === "dynamic" ? "Segment" : "List"}
                    </Badge>
                    <span className="w-[70px] shrink-0 text-right text-[12.5px] font-medium tabular-nums">
                      {campaignListRecipientCount(list).toLocaleString()}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-12 text-center text-[11.5px] text-muted-foreground">
            {lists.length
              ? "No list matches that search."
              : "No lists yet. Create one under CRM → Contacts."}
          </p>
        )}
      </section>

      <div className="mt-4">
        {excluding ? (
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                Exclude a list
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-[11.5px]"
                onClick={() => {
                  setExcluding(false);
                  onExcludeChange("");
                }}
              >
                <X className="h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
            <div className="mt-3">
              <Select
                value={excludeListId || "__none__"}
                onValueChange={(value) =>
                  onExcludeChange(value === "__none__" ? "" : value)
                }
              >
                <SelectTrigger className="h-9 text-[12px]" aria-label="List to exclude">
                  <SelectValue placeholder="Choose a list to exclude" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No exclusion</SelectItem>
                  {lists
                    .filter((list) => list.id !== listId)
                    .map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name} ({campaignListRecipientCount(list).toLocaleString()})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Anyone on both lists is removed from this send. Useful for skipping
                people who already converted.
              </p>
            </div>
          </section>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setExcluding(true)}
            disabled={lists.length < 2}
          >
            <Users className="h-4 w-4" />
            Exclude a list
          </Button>
        )}
      </div>
    </div>
  );
}

function RecipientsStep({
  lists,
  audienceMode,
  listIds,
  customRecipients,
  excludeListId,
  onAudienceModeChange,
  onToggleList,
  onCustomRecipientsChange,
  onValidateCustomRecipients,
  onExcludeChange,
  audienceCount,
  audienceLoading,
}: {
  lists: ContactListRecord[];
  audienceMode: CampaignAudienceMode;
  listIds: string[];
  customRecipients: string[];
  excludeListId: string;
  onAudienceModeChange: (mode: CampaignAudienceMode) => void;
  onToggleList: (listId: string) => void;
  onCustomRecipientsChange: (recipients: string[]) => void;
  onValidateCustomRecipients: (recipients: string[]) => Promise<string[]>;
  onExcludeChange: (listId: string) => void;
  audienceCount: number | null;
  audienceLoading: boolean;
}) {
  const [excluding, setExcluding] = useState(Boolean(excludeListId));

  useEffect(() => {
    if (audienceMode === "custom") setExcluding(false);
  }, [audienceMode]);

  return (
    <div className="mx-auto w-full max-w-[1000px]">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[26px] font-semibold tracking-tight">
          Selected recipients:
        </h2>
        <span className="text-[26px] font-semibold tracking-tight text-primary">
          {audienceLoading ? (
            <Loader2 className="mb-1 inline h-5 w-5 animate-spin" />
          ) : (
            (audienceCount ?? 0).toLocaleString()
          )}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] text-muted-foreground">
        Choose multiple CRM lists and segments, or enter recipients directly.
        Overlapping list members are automatically deduplicated.
      </p>

      <div className="mt-5">
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
      </div>

      {audienceMode === "lists" ? (
        <div className="mt-4">
          {excluding ? (
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                  <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                  Exclude a list
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-[11.5px]"
                  onClick={() => {
                    setExcluding(false);
                    onExcludeChange("");
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
              <div className="mt-3">
                <Select
                  value={excludeListId || "__none__"}
                  onValueChange={(value) =>
                    onExcludeChange(value === "__none__" ? "" : value)
                  }
                >
                  <SelectTrigger
                    className="h-9 text-[12px]"
                    aria-label="List to exclude"
                  >
                    <SelectValue placeholder="Choose a list to exclude" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No exclusion</SelectItem>
                    {lists
                      .filter((list) => !listIds.includes(list.id))
                      .map((list) => (
                        <SelectItem key={list.id} value={list.id}>
                          {list.name} ({campaignListRecipientCount(list).toLocaleString()})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Anyone on the exclusion list is removed from the combined audience.
                </p>
              </div>
            </section>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setExcluding(true)}
              disabled={lists.length < 2}
            >
              <Users className="h-4 w-4" />
              Exclude a list
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Custom email audiences are checked against unsubscribes and suppressions before sending.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ step 4 */

function ReviewStep({
  draft,
  identity,
  design,
  review,
  reviewLoading,
  lists,
  audienceMode,
  listIds,
  customRecipients,
  excludeListId,
  onEditStep,
  onSendTest,
  onOpenBuilder,
  onAdvanced,
}: {
  draft: FlowDraft;
  identity: EmailIdentity | null;
  design: CampaignDesign;
  review: CampaignWizardReview | null;
  reviewLoading: boolean;
  lists: ContactListRecord[];
  audienceMode: CampaignAudienceMode;
  listIds: string[];
  customRecipients: string[];
  excludeListId: string;
  onEditStep: (step: FlowStep) => void;
  onSendTest: () => void;
  onOpenBuilder: () => void;
  onAdvanced: () => void;
}) {
  const [showPlainText, setShowPlainText] = useState(false);
  const selectedLists = listIds
    .map((id) => lists.find((item) => item.id === id))
    .filter(Boolean) as ContactListRecord[];
  const excluded = lists.find((item) => item.id === excludeListId) || null;
  const blockers = review?.blockers || [];
  const total =
    review?.audience?.deliverable ??
    (audienceMode === "custom"
      ? customRecipients.length
      : selectedLists.reduce(
          (sum, list) => sum + campaignListRecipientCount(list),
          0,
        ));

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <h2 className="text-[26px] font-semibold tracking-tight">Review and send</h2>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          {blockers.length ? (
            <section className="rounded-xl border border-destructive/40 bg-destructive/4 p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-semibold text-destructive">Errors</h3>
                <span className="text-[12px] font-medium text-destructive">
                  {blockers.length}
                </span>
              </div>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                These must be resolved before the campaign can be sent.
              </p>
              <ul className="mt-3 space-y-1.5">
                {blockers.map((blocker) => (
                  <li
                    key={blocker}
                    className="flex items-start gap-2 text-[12px] font-medium"
                  >
                    <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" />
                    {blocker}
                  </li>
                ))}
              </ul>
            </section>
          ) : reviewLoading ? (
            <section className="flex items-center gap-2 rounded-xl border border-border bg-card p-5 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Running the pre-send checks…
            </section>
          ) : (
            <section className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-[13px] font-semibold">Ready to send</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  Sender verified, audience resolved, content complete.
                </p>
              </div>
            </section>
          )}

          <Panel
            title="Settings"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[11.5px]"
                onClick={() => onEditStep("settings")}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            }
          >
            <dl className="space-y-3.5">
              <div>
                <dt className="text-[11px] text-muted-foreground">Email subject</dt>
                <dd className="mt-0.5 text-[13px]">{draft.subject || "Not set"}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Email preview text</dt>
                <dd className="mt-0.5 text-[13px]">{draft.previewText || "Not set"}</dd>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] text-muted-foreground">From name</dt>
                  <dd className="mt-0.5 truncate text-[13px]">
                    {identity?.senderName || "Not set"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">
                    Sender email address
                  </dt>
                  <dd className="mt-0.5 truncate text-[13px]">
                    {identity?.senderEmail || "Not set"}
                  </dd>
                </div>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Campaign name</dt>
                <dd className="mt-0.5 text-[13px]">{draft.name || "Not set"}</dd>
              </div>
            </dl>
          </Panel>

          <Panel
            title="Recipients"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[11.5px]"
                onClick={() => onEditStep("recipients")}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            }
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">
                    {audienceMode === "custom"
                      ? "Custom email addresses"
                      : selectedLists.map((list) => list.name).join(", ") || "No audience"}
                  </span>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-border/70 text-[9px] text-muted-foreground"
                  >
                    {audienceMode === "custom"
                      ? "Custom"
                      : `${selectedLists.length} list${selectedLists.length === 1 ? "" : "s"}`}
                  </Badge>
                </span>
                <span className="shrink-0 tabular-nums">
                  {audienceMode === "custom"
                    ? customRecipients.length.toLocaleString()
                    : selectedLists
                        .reduce(
                          (sum, list) => sum + campaignListRecipientCount(list),
                          0,
                        )
                        .toLocaleString()}
                </span>
              </div>
              {excluded ? (
                <div className="flex items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-2">
                    <Ban className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Excluding {excluded.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    −{campaignListRecipientCount(excluded).toLocaleString()}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2.5">
                <span className="text-[12px] text-muted-foreground">
                  Total recipients
                </span>
                <span className="text-[15px] font-semibold tabular-nums">
                  {reviewLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    total.toLocaleString()
                  )}
                </span>
              </div>
            </div>
          </Panel>

          {/* Send now and a chosen time cover almost every campaign. A/B
              splits, recurring sends and send-time optimisation are real but
              rarer, so they sit behind the long-form wizard rather than
              crowding this step. It reopens from its own first step, which is
              why this is named for the wizard and not for one of its options. */}
          <button
            type="button"
            onClick={onAdvanced}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3.5 text-left transition-colors hover:border-primary/40"
          >
            <span>
              <span className="block text-[12.5px] font-medium">
                Open the full send wizard
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                A/B test the subject, repeat this send, or optimise per timezone.
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </div>

        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={showPlainText ? "outline" : "secondary"}
              size="sm"
              className="h-8 text-[11.5px]"
              onClick={() => setShowPlainText(false)}
            >
              <Eye className="h-3 w-3" />
              Preview
            </Button>
            <Button
              type="button"
              variant={showPlainText ? "secondary" : "outline"}
              size="sm"
              className="h-8 text-[11.5px]"
              onClick={() => setShowPlainText(true)}
            >
              <FileText className="h-3 w-3" />
              Plain text
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[11.5px]"
              onClick={onSendTest}
            >
              <Send className="h-3 w-3" />
              Send test email
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto h-8 text-[11.5px]"
              onClick={onOpenBuilder}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          </div>

          <div className="dashboard-scroll mt-4 max-h-[calc(100vh-330px)] min-h-[320px] overflow-y-auto rounded-lg border border-border bg-background">
            {showPlainText ? (
              // The same extraction the send path uses for the text/plain part,
              // so this is what a text-only client will actually show.
              <pre className="whitespace-pre-wrap p-4 font-sans text-[12px] leading-5 text-foreground">
                {campaignPlainText(design) || "This design has no text content yet."}
              </pre>
            ) : (
              <CampaignPreview design={design} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- flow */

export function CampaignCreateFlow({
  open,
  step,
  onStepChange,
  draft,
  onDraftChange,
  identity,
  identityLoading,
  onManageSender,
  designMode,
  onDesignModeChange,
  onSettingsContinue,
  selectedTemplateId,
  onSelectTemplate,
  design,
  hasExistingDesign,
  hasBuilderSession,
  onOpenBuilder,
  lists,
  audienceMode,
  listIds,
  customRecipients,
  excludeListId,
  onAudienceModeChange,
  onToggleList,
  onCustomRecipientsChange,
  onValidateCustomRecipients,
  onExcludeChange,
  audienceCount,
  audienceLoading,
  review,
  reviewLoading,
  onSendTest,
  onRecipientsContinue,
  onSendNow,
  onSchedule,
  onAdvanced,
  onFinishLater,
  dirty,
  working,
}: {
  open: boolean;
  step: FlowStep;
  onStepChange: (step: FlowStep) => void;
  draft: FlowDraft;
  onDraftChange: (draft: FlowDraft) => void;
  identity: EmailIdentity | null;
  identityLoading: boolean;
  onManageSender: () => void;
  designMode: DesignMode;
  onDesignModeChange: (mode: DesignMode) => void;
  /** Existing campaigns resume the saved authoring surface after Settings. */
  onSettingsContinue?: () => void;
  selectedTemplateId: string | null;
  onSelectTemplate: (template: CampaignTemplate | null) => void;
  design: CampaignDesign;
  hasExistingDesign: boolean;
  /** The selected authoring mode has already been opened in this flow. */
  hasBuilderSession: boolean;
  onOpenBuilder: () => void;
  lists: ContactListRecord[];
  audienceMode: CampaignAudienceMode;
  listIds: string[];
  customRecipients: string[];
  excludeListId: string;
  onAudienceModeChange: (mode: CampaignAudienceMode) => void;
  onToggleList: (listId: string) => void;
  onCustomRecipientsChange: (recipients: string[]) => void;
  onValidateCustomRecipients: (recipients: string[]) => Promise<string[]>;
  onExcludeChange: (listId: string) => void;
  audienceCount: number | null;
  audienceLoading: boolean;
  review: CampaignWizardReview | null;
  reviewLoading: boolean;
  onSendTest: () => void;
  /** Persist the current audience before the review query runs. */
  onRecipientsContinue?: () => Promise<boolean>;
  onSendNow: () => void;
  onSchedule: () => void;
  onAdvanced: () => void;
  onFinishLater: (options: { save: boolean }) => void;
  dirty: boolean;
  working: boolean;
}) {
  // Opening covers the first paint of the identity, the inbox preview and the
  // template thumbnails behind it, so the modal never appears half-built.
  const { phase, coversSurface, transitionTo, exitWith } = useStagedTransition({
    open,
  });
  const [exitPrompt, setExitPrompt] = useState(false);
  const stepIndex = steps.findIndex((item) => item.key === step);
  const [furthest, setFurthest] = useState(stepIndex);

  useEffect(() => {
    setFurthest((current) => Math.max(current, stepIndex));
  }, [stepIndex]);

  useEffect(() => {
    if (!open) setExitPrompt(false);
  }, [open]);

  /** Closes for real, after a brief hold so the exit is not an abrupt cut. */
  const runClose = (save: boolean) => {
    setExitPrompt(false);
    exitWith(() => onFinishLater({ save }));
  };

  /**
   * Every way out goes through here.
   *
   * Escape, the backdrop and "I'll finish later" all land on the same guard, so
   * unsaved work cannot be lost by picking the wrong exit.
   */
  const requestClose = () => {
    if (working) return;
    if (dirty) {
      setExitPrompt(true);
      return;
    }
    runClose(false);
  };

  /**
   * Moves between steps with a short hold either side.
   *
   * The pause is what makes the change feel deliberate rather than a flicker,
   * and it covers the moment each step's data resolves.
   */
  const goTo = (next: FlowStep) => {
    if (next === step) return;
    transitionTo(() => onStepChange(next));
  };

  const senderReady = Boolean(identity?.senderReady);
  const canLeaveSettings = draft.subject.trim().length > 0 && senderReady;
  const canLeaveRecipients =
    !audienceLoading &&
    audienceCount !== null &&
    audienceCount > 0 &&
    (audienceMode === "lists" ? listIds.length > 0 : customRecipients.length > 0);

  const primary = (() => {
    if (step === "settings") {
      return {
        label: "Save and continue",
        disabled: !canLeaveSettings,
        onClick: () =>
          onSettingsContinue ? onSettingsContinue() : goTo("design"),
      };
    }
    if (step === "design") {
      return {
        label: hasBuilderSession ? "Continue editing" : "Start creating",
        disabled: false,
        onClick: onOpenBuilder,
      };
    }
    if (step === "recipients") {
      return {
        label: "Save and continue",
        disabled: !canLeaveRecipients,
        onClick: async () => {
          if (onRecipientsContinue && !(await onRecipientsContinue())) return;
          goTo("review");
        },
      };
    }
    return {
      label: "Send now",
      disabled: working || reviewLoading || !review?.canSend,
      onClick: onSendNow,
    };
  })();

  const loaderLabel =
    phase === "opening"
      ? "Setting up your campaign…"
      : phase === "closing"
        ? "Closing…"
        : phase === "leaving"
          ? "Saving this step…"
          : step === "design"
            ? "Loading templates…"
            : step === "recipients"
              ? "Counting your audience…"
              : step === "review"
                ? "Running pre-send checks…"
                : "Loading…";

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? requestClose() : undefined)}>
      <DialogContent
        // Builder-sized, with its own chrome: the default close button would
        // collide with the header actions.
        className="flex h-[94vh] w-[97vw] max-w-[1500px] flex-col gap-0 overflow-hidden p-0 [&>button]:hidden"
        onEscapeKeyDown={(event) => {
          // Handled by the guard so unsaved work prompts rather than vanishing.
          event.preventDefault();
          if (exitPrompt) return;
          requestClose();
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
          // The exit prompt lives outside this content, so a click on it reads
          // as an outside interaction. Answering it must not re-trigger the
          // guard that opened it.
          if (exitPrompt) return;
          requestClose();
        }}
      >
        <DialogTitle className="sr-only">Create a campaign</DialogTitle>
        <DialogDescription className="sr-only">
          Four steps: campaign settings, design, recipients, then review and send.
        </DialogDescription>

        {/* Opening and closing take over the whole panel rather than sitting on
            top of it: a half-built modal behind a spinner is worse than no modal
            at all, and the same is true on the way out. */}
        {coversSurface ? (
          <StageLoader phase={phase} label={loaderLabel} variant="surface" />
        ) : (
        <>
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <StepRail active={step} furthest={furthest} onJump={goTo} />

          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-[12px]"
                onClick={() => goTo(steps[stepIndex - 1].key)}
                disabled={working}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 text-[12px] font-medium"
              onClick={requestClose}
              disabled={working}
            >
              I'll finish later
            </Button>
            {step === "review" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 text-[12px]"
                onClick={onSchedule}
                disabled={working || reviewLoading || !review?.canSend}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                Schedule
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="h-9 px-5 text-[12px]"
              onClick={primary.onClick}
              disabled={primary.disabled || working}
            >
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {primary.label}
            </Button>
            <button
              type="button"
              onClick={requestClose}
              disabled={working}
              aria-label="Close campaign flow"
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="dashboard-scroll relative min-h-0 flex-1 overflow-y-auto bg-muted/25 px-5 py-6">
          <StageLoader phase={phase} label={loaderLabel} />

          <div
            className={cn(
              "transition-opacity duration-200",
              phase === "leaving" ? "opacity-0" : "opacity-100",
            )}
          >
            <Reveal motionKey={step}>
            {step === "settings" ? (
              <SettingsStep
                draft={draft}
                onDraftChange={onDraftChange}
                identity={identity}
                identityLoading={identityLoading}
                onManageSender={onManageSender}
              />
            ) : null}

            {step === "design" ? (
              <DesignStep
                mode={designMode}
                onModeChange={onDesignModeChange}
                selectedTemplateId={selectedTemplateId}
                onSelectTemplate={onSelectTemplate}
                hasExistingDesign={hasExistingDesign}
              />
            ) : null}

            {step === "recipients" ? (
              <RecipientsStep
                lists={lists}
                audienceMode={audienceMode}
                listIds={listIds}
                customRecipients={customRecipients}
                excludeListId={excludeListId}
                onAudienceModeChange={onAudienceModeChange}
                onToggleList={onToggleList}
                onCustomRecipientsChange={onCustomRecipientsChange}
                onValidateCustomRecipients={onValidateCustomRecipients}
                onExcludeChange={onExcludeChange}
                audienceCount={audienceCount}
                audienceLoading={audienceLoading}
              />
            ) : null}

            {step === "review" ? (
              <ReviewStep
                draft={draft}
                identity={identity}
                design={design}
                review={review}
                reviewLoading={reviewLoading}
                lists={lists}
                audienceMode={audienceMode}
                listIds={listIds}
                customRecipients={customRecipients}
                excludeListId={excludeListId}
                onEditStep={goTo}
                onSendTest={onSendTest}
                onOpenBuilder={onOpenBuilder}
                onAdvanced={onAdvanced}
              />
            ) : null}
            </Reveal>
          </div>
        </div>
        </>
        )}

        {exitPrompt ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/75 p-6 backdrop-blur-[2px]">
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="flow-exit-title"
              aria-describedby="flow-exit-body"
              className="w-full max-w-[460px] rounded-xl border border-border bg-card p-6 shadow-2xl"
            >
              <h2 id="flow-exit-title" className="text-[16px] font-semibold">
                Save your changes?
              </h2>
              <p
                id="flow-exit-body"
                className="mt-2 text-[12.5px] leading-5 text-muted-foreground"
              >
                This campaign has edits that have not been saved yet. Save it as a
                draft and you can pick it up from All campaigns whenever you like.
              </p>
              <div className="mt-6 flex min-w-0 flex-col gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  disabled={working}
                  onClick={() => setExitPrompt(false)}
                >
                  Keep editing
                </Button>
                <div className="flex w-full min-w-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={working}
                    onClick={() => runClose(false)}
                  >
                    Discard changes
                  </Button>
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    disabled={working}
                    onClick={() => runClose(true)}
                  >
                    {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save draft and close
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

      </DialogContent>
    </Dialog>
  );
}

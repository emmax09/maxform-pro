/**
 * Campaign editors for plain text and custom HTML messages.
 *
 * These modes use the same focused modal shell as the block builder. They
 * change the canvas, not the working experience: the campaign name and inbox
 * fields stay in the header, the editor sits on the canvas, and document
 * settings stay in the right-hand inspector.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  ArrowLeft,
  Check,
  Code2,
  Eye,
  Inbox,
  Loader2,
  Monitor,
  Pencil,
  RotateCcw,
  Save,
  Smartphone,
  Tablet,
  Trash2,
  TriangleAlert,
  Type,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StageLoader, Spinner } from "@/components/shared/transitions";
import { useStagedTransition } from "@/hooks/use-staged-transition";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { cn } from "@/lib/utils";

import { CampaignVariablePicker } from "./CampaignVariablePicker";
import {
  campaignLanguages,
  emailSafeFonts,
  resolveTypography,
  type CampaignDesign,
  type CampaignPreviewDevice,
  type CampaignPreviewTheme,
  type CampaignTypography,
} from "./campaign-blocks";
import { CampaignPreview } from "./CampaignPreview";

export type SimpleBuilderMode = "plain_text" | "custom_html";

export type SimpleBuilderDraft = {
  id?: string;
  name: string;
  subject: string;
  previewText: string;
  design: CampaignDesign;
};

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-4 last:border-b-0">
      <h3 className="text-[12.5px] font-semibold">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function FieldLabel({ children, htmlFor }: { children: string; htmlFor?: string }) {
  return (
    <Label
      htmlFor={htmlFor}
      className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
    >
      {children}
    </Label>
  );
}

function FontFields({
  idPrefix,
  label,
  family,
  size,
  onFamilyChange,
  onSizeChange,
}: {
  idPrefix: string;
  label: string;
  family: string;
  size: number;
  onFamilyChange: (value: string) => void;
  onSizeChange: (value: number) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <FieldLabel htmlFor={idPrefix + "-family"}>Font family</FieldLabel>
        <Select
          value={family || "inherit"}
          onValueChange={(value) => onFamilyChange(value === "inherit" ? "" : value)}
        >
          <SelectTrigger
            id={idPrefix + "-family"}
            className="h-9 text-[12px]"
            aria-label={label + " font family"}
          >
            <SelectValue placeholder="Select option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Same as body text</SelectItem>
            {emailSafeFonts.map((font) => (
              <SelectItem key={font.value} value={font.value}>
                {font.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor={idPrefix + "-size"}>Font size</FieldLabel>
        <Input
          id={idPrefix + "-size"}
          type="number"
          min={8}
          max={72}
          value={size}
          aria-label={label + " font size"}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onSizeChange(Math.min(72, Math.max(8, next)));
          }}
          className="h-9 text-[12px]"
        />
      </div>
    </>
  );
}

function TypeSettingsPanel({
  typography,
  onChange,
}: {
  typography: Required<CampaignTypography>;
  onChange: (patch: Partial<CampaignTypography>) => void;
}) {
  return (
    <aside
      aria-label="Type settings"
      className="dashboard-scroll flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card"
    >
      <SettingsGroup title="Text settings">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="type-link-colour">Link colour</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              id="type-link-colour"
              type="color"
              value={typography.linkColor}
              onChange={(event) => onChange({ linkColor: event.target.value })}
              aria-label="Link colour"
              className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-1"
            />
            <Input
              value={typography.linkColor}
              onChange={(event) => onChange({ linkColor: event.target.value })}
              aria-label="Link colour hex"
              className="h-9 font-mono text-[12px] uppercase"
            />
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-md bg-amber-500/8 p-2.5 text-[10.5px] leading-4 text-muted-foreground">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>
            Few email clients support custom web fonts. A similar web-safe font is
            used where needed.
          </span>
        </p>

        <FontFields
          idPrefix="type-body"
          label="Body text"
          family={typography.fontFamily}
          size={typography.fontSize}
          onFamilyChange={(fontFamily) => onChange({ fontFamily })}
          onSizeChange={(fontSize) => onChange({ fontSize })}
        />
      </SettingsGroup>

      <SettingsGroup title="Heading 1 settings">
        <FontFields
          idPrefix="type-h1"
          label="Heading 1"
          family={typography.headingOneFamily}
          size={typography.headingOneSize}
          onFamilyChange={(headingOneFamily) => onChange({ headingOneFamily })}
          onSizeChange={(headingOneSize) => onChange({ headingOneSize })}
        />
      </SettingsGroup>

      <SettingsGroup title="Heading 2 settings">
        <FontFields
          idPrefix="type-h2"
          label="Heading 2"
          family={typography.headingTwoFamily}
          size={typography.headingTwoSize}
          onFamilyChange={(headingTwoFamily) => onChange({ headingTwoFamily })}
          onSizeChange={(headingTwoSize) => onChange({ headingTwoSize })}
        />
      </SettingsGroup>

      <SettingsGroup title="Heading 3 settings">
        <FontFields
          idPrefix="type-h3"
          label="Heading 3"
          family={typography.headingThreeFamily}
          size={typography.headingThreeSize}
          onFamilyChange={(headingThreeFamily) => onChange({ headingThreeFamily })}
          onSizeChange={(headingThreeSize) => onChange({ headingThreeSize })}
        />
      </SettingsGroup>

      <SettingsGroup title="Preview & unsubscribe">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="type-language">Language</FieldLabel>
          <Select
            value={typography.language}
            onValueChange={(language) => onChange({ language })}
          >
            <SelectTrigger
              id="type-language"
              className="h-9 text-[12px]"
              aria-label="Language"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {campaignLanguages.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10.5px] leading-4 text-muted-foreground">
            Sets the document language and the wording of the unsubscribe line.
          </p>
        </div>
      </SettingsGroup>
    </aside>
  );
}

function simplePreviewWidth(device: CampaignPreviewDevice) {
  if (device === "mobile") return 360;
  if (device === "tablet") return 480;
  return 600;
}

function SimpleLivePreview({
  mode,
  draft,
  body,
  device,
  theme,
}: {
  mode: SimpleBuilderMode;
  draft: SimpleBuilderDraft;
  body: string;
  device: CampaignPreviewDevice;
  theme: CampaignPreviewTheme;
}) {
  const width = simplePreviewWidth(device);
  const previewSurface =
    device === "mobile"
      ? "max-w-[430px]"
      : device === "tablet"
        ? "max-w-[590px]"
        : "max-w-[760px]";

  return (
    <div
      role="region"
      aria-label="Campaign live preview"
      className={cn("mx-auto w-full space-y-3", previewSurface)}
    >
      <div className="rounded-lg border border-border bg-card p-3.5 shadow-xs">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Eye className="h-3.5 w-3.5 text-primary" />
            <p className="text-[12px] font-semibold">Live inbox preview</p>
          </div>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
            {device}
          </span>
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
          <p className="truncate text-[12px] font-semibold">
            {draft.subject.trim() || "No subject line yet"}
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {draft.previewText.trim() || "No preview line yet"}
          </p>
        </div>
      </div>

      <div
        className={cn(
          "overflow-auto rounded-lg border border-border p-2 sm:p-3",
          theme === "dark" ? "bg-[#111318]" : "bg-muted/30",
        )}
      >
        {mode === "plain_text" ? (
          <CampaignPreview
            design={draft.design}
            width={width}
            breakpoint={device}
          />
        ) : body.trim() ? (
          <div
            className="mx-auto w-full overflow-hidden rounded-lg border border-border bg-white shadow-xs"
            style={{ maxWidth: width }}
          >
            <iframe
              title="Custom HTML live preview"
              sandbox=""
              srcDoc={body}
              className="block w-full border-0"
              style={{
                height: "min(720px, calc(100dvh - 360px))",
                minHeight: 460,
              }}
            />
          </div>
        ) : (
          <div
            className="mx-auto flex min-h-[460px] items-center justify-center rounded-lg border border-dashed border-border bg-background text-center"
            style={{ maxWidth: width }}
          >
            <p className="px-6 text-[11.5px] text-muted-foreground">
              Add HTML on the editor to see the live email preview.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function CampaignSimpleBuilder({
  mode,
  draft,
  onDraftChange,
  onExit,
  onSaveDraft,
  onSaveAndContinue,
  onStartOver,
  saving,
  continuing,
}: {
  mode: SimpleBuilderMode;
  draft: SimpleBuilderDraft;
  onDraftChange: (draft: SimpleBuilderDraft) => void;
  onExit: () => void;
  onSaveDraft: (draft: SimpleBuilderDraft) => Promise<unknown> | unknown;
  onSaveAndContinue: () => void;
  onStartOver: () => void;
  saving: boolean;
  continuing: boolean;
}) {
  useScrollLock(true);
  const { phase, coversSurface, exitWith } = useStagedTransition({ open: true });
  const [startOverOpen, setStartOverOpen] = useState(false);
  const [confirmingExit, setConfirmingExit] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [touched, setTouched] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [device, setDevice] = useState<CampaignPreviewDevice>("desktop");
  const { resolvedTheme } = useTheme();
  const theme: CampaignPreviewTheme =
    resolvedTheme === "dark" ? "dark" : "light";
  const [previewing, setPreviewing] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const changeDraft = (next: SimpleBuilderDraft) => {
    setTouched(true);
    setDirty(true);
    onDraftChange(next);
  };

  const typography = useMemo(
    () => resolveTypography(draft.design.typography),
    [draft.design.typography],
  );
  const blockKind = mode === "plain_text" ? "text" : "html";
  const body = useMemo(() => {
    const block = draft.design.blocks.find((item) => item.type === blockKind);
    if (!block) return "";
    return blockKind === "text"
      ? String((block as { content?: string }).content || "")
      : String((block as { html?: string }).html || "");
  }, [blockKind, draft.design.blocks]);

  const setBody = (value: string) => {
    changeDraft({
      ...draft,
      design: {
        ...draft.design,
        blocks: draft.design.blocks.map((item) =>
          item.type === blockKind
            ? blockKind === "text"
              ? { ...item, content: value }
              : { ...item, html: value }
            : item,
        ),
      },
    });
  };

  const setTypography = (patch: Partial<CampaignTypography>) => {
    changeDraft({
      ...draft,
      design: {
        ...draft.design,
        typography: { ...(draft.design.typography || {}), ...patch },
      },
    });
  };

  const insertVariable = (token: string) => {
    const element = bodyRef.current;
    const at = element?.selectionStart ?? body.length;
    setBody(body.slice(0, at) + token + body.slice(at));
    window.requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const missingInboxFields = [
    !draft.subject.trim() ? "Subject line" : "",
    !draft.previewText.trim() ? "Preview line" : "",
  ].filter(Boolean);
  const isSaving = saving || savingDraft;

  const saveDraft = async () => {
    if (isSaving) return;
    setSavingDraft(true);
    try {
      const result = await onSaveDraft(draft);
      if (result !== null && result !== false) {
        setDirty(false);
        setTouched(false);
        setSavedAt(
          new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        );
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const saveAndExit = async () => {
    if (isSaving) return;
    setSavingDraft(true);
    try {
      const result = await onSaveDraft(draft);
      if (result === null || result === false) return;
      setDirty(false);
      setTouched(false);
      setConfirmingExit(false);
      exitWith(onExit);
    } finally {
      setSavingDraft(false);
    }
  };

  const requestExit = () => {
    if (touched || dirty) {
      setConfirmingExit(true);
      return;
    }
    exitWith(onExit);
  };

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <div
      className={cn(
        theme,
        "fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-2 backdrop-blur-xs transition-opacity duration-200 sm:p-4 lg:p-6",
      )}
    >
      <div
        role="region"
        aria-label="Campaign builder"
        className="flex h-full max-h-[min(940px,100%)] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl"
      >
        {coversSurface ? (
          <StageLoader
            phase={phase}
            variant="surface"
            label={
              phase === "closing"
                ? "Closing the builder..."
                : mode === "plain_text"
                  ? "Opening the text editor..."
                  : "Opening the HTML editor..."
            }
          />
        ) : (
          <>
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5">
              <Button type="button" size="sm" variant="ghost" onClick={requestExit}>
                <ArrowLeft className="h-4 w-4" />
                Exit
              </Button>
              <div className="min-w-0 flex-1">
                <label className="sr-only" htmlFor="simple-builder-name">
                  Campaign name
                </label>
                <input
                  id="simple-builder-name"
                  value={draft.name}
                  onChange={(event) =>
                    changeDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="Untitled campaign"
                  className="w-full max-w-[420px] rounded-md border border-transparent bg-transparent px-2 py-1 text-[15px] font-semibold outline-hidden transition-colors hover:border-border focus:border-primary focus:bg-background"
                />
                <p className="px-2 text-[10px] text-muted-foreground" aria-live="polite">
                  {isSaving
                    ? "Saving..."
                    : savedAt
                      ? "Saved " + savedAt
                      : mode === "plain_text"
                        ? "Plain text email"
                        : "Custom HTML email"}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <div className="flex rounded-md border border-border p-0.5">
                  {(
                    [
                      [false, "Edit", Pencil],
                      [true, "Preview", Eye],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setPreviewing(value)}
                      aria-pressed={previewing === value}
                      aria-label={label}
                      className={cn(
                        "flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors",
                        previewing === value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-md border border-border p-0.5">
                  {(
                    [
                      ["desktop", Monitor, "Desktop preview"],
                      ["tablet", Tablet, "Tablet preview"],
                      ["mobile", Smartphone, "Mobile preview"],
                    ] as const
                  ).map(([value, Icon, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDevice(value)}
                      aria-label={label}
                      aria-pressed={device === value}
                      className={cn(
                        "flex h-7 w-8 items-center justify-center rounded",
                        device === value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setStartOverOpen(true)}
                  disabled={isSaving || continuing}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Start from scratch
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void saveDraft()}
                  disabled={isSaving || continuing || !dirty}
                >
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Save draft
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onSaveAndContinue}
                  disabled={
                    continuing ||
                    !dirty ||
                    missingInboxFields.length > 0 ||
                    !body.trim()
                  }
                  title={
                    missingInboxFields.length
                      ? "Add the " +
                        missingInboxFields.join(" and ").toLowerCase() +
                        " first"
                      : !body.trim()
                        ? "Write the email first"
                        : undefined
                  }
                >
                  {continuing ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save &amp; Continue
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0"
                  aria-label="Close builder"
                  title="Close builder"
                  onClick={requestExit}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </header>

            <div
              className={cn(
                "shrink-0 border-b px-4 py-3 transition-colors",
                missingInboxFields.length
                  ? "border-amber-500/40 bg-amber-500/6"
                  : "border-border bg-card",
              )}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-[11px] font-semibold">What lands in the inbox</p>
                {missingInboxFields.length ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    {missingInboxFields.join(" and ")} still needed
                  </span>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label
                    htmlFor="simple-subject"
                    className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground"
                  >
                    Subject line
                  </Label>
                  <Input
                    id="simple-subject"
                    value={draft.subject}
                    onChange={(event) =>
                      changeDraft({ ...draft, subject: event.target.value })
                    }
                    placeholder="Subject line"
                    aria-label="Subject line"
                    className="h-9 text-[12.5px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="simple-preview"
                    className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground"
                  >
                    Preview line
                  </Label>
                  <Input
                    id="simple-preview"
                    value={draft.previewText}
                    onChange={(event) =>
                      changeDraft({ ...draft, previewText: event.target.value })
                    }
                    placeholder="Preview line"
                    aria-label="Preview line"
                    className="h-9 text-[12.5px]"
                  />
                </div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
              <div className="dashboard-scroll min-h-0 overflow-y-auto bg-muted/30 p-4 sm:p-5">
                {previewing ? (
                  <SimpleLivePreview
                    mode={mode}
                    draft={draft}
                    body={body}
                    device={device}
                    theme={theme}
                  />
                ) : (
                  <div
                    className={cn(
                      "mx-auto flex min-h-[420px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xs",
                      device === "mobile"
                        ? "max-w-[400px]"
                        : device === "tablet"
                          ? "max-w-[560px]"
                          : "max-w-[920px]",
                    )}
                  >
                    {mode === "plain_text" ? (
                    <>
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5">
                        <span className="flex items-center gap-2 text-[12px] font-medium">
                          <Type className="h-3.5 w-3.5 text-muted-foreground" />
                          Plain text canvas
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            {body.trim()
                              ? body.trim().split(/\s+/).length + " words"
                              : "Empty"}
                          </span>
                          <CampaignVariablePicker onInsert={insertVariable} />
                        </div>
                      </div>
                      <div className="dashboard-scroll min-h-0 flex-1 overflow-y-auto bg-muted/20 p-5 sm:p-7">
                        <div className="mx-auto w-full max-w-[680px] rounded-lg border border-border bg-background p-5 shadow-xs sm:p-7">
                          <Label htmlFor="simple-body" className="sr-only">
                            Plain text body
                          </Label>
                          <Textarea
                            id="simple-body"
                            ref={bodyRef}
                            value={body}
                            onChange={(event) => setBody(event.target.value)}
                            placeholder={PLAIN_PLACEHOLDER}
                            style={{
                              fontFamily: typography.fontFamily,
                              fontSize: typography.fontSize + "px",
                            }}
                            className="dashboard-scroll h-[min(56dvh,620px)] min-h-[380px] max-h-[calc(100dvh-360px)] resize-y overflow-y-auto border-border bg-card leading-relaxed shadow-xs"
                          />
                          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                            Plain text stays lightweight and keeps line breaks. The
                            unsubscribe line is added when the campaign is sent.
                          </p>
                        </div>
                      </div>
                    </>
                    ) : (
                      <div className="grid min-h-[420px] min-w-0 flex-1 grid-cols-1 lg:grid-cols-2">
                      <div className="flex min-h-0 min-w-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5">
                          <span className="flex items-center gap-2 text-[12px] font-medium">
                            <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
                            HTML source
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">
                              {body.length.toLocaleString()} characters
                            </span>
                            <CampaignVariablePicker onInsert={insertVariable} />
                          </div>
                        </div>
                        <div className="min-h-0 flex-1 p-4">
                          <Label htmlFor="simple-body" className="sr-only">
                            Custom HTML source
                          </Label>
                          <Textarea
                            id="simple-body"
                            ref={bodyRef}
                            value={body}
                            onChange={(event) => setBody(event.target.value)}
                            spellCheck={false}
                            placeholder={HTML_PLACEHOLDER}
                            className="dashboard-scroll h-full min-h-[330px] resize-none border-border font-mono text-[12px] leading-5"
                          />
                        </div>
                      </div>
                      <div className="flex min-h-0 min-w-0 flex-col bg-muted/20">
                        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2.5">
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-[12px] font-medium">Live preview</span>
                        </div>
                        <div className="min-h-0 flex-1 p-4">
                          {body.trim() ? (
                            <iframe
                              title="Custom HTML preview"
                              sandbox=""
                              srcDoc={body}
                              className="h-full min-h-[330px] w-full rounded-lg border border-border bg-white"
                            />
                          ) : (
                            <div className="flex h-full min-h-[330px] items-center justify-center rounded-lg border border-dashed border-border">
                              <p className="px-6 text-center text-[11.5px] text-muted-foreground">
                                Paste your HTML on the left and it renders here.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <TypeSettingsPanel typography={typography} onChange={setTypography} />
            </div>
          </>
        )}

        <Dialog
          open={confirmingExit}
          onOpenChange={(open) => {
            if (!open && !isSaving) setConfirmingExit(false);
          }}
        >
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle>Save your changes?</DialogTitle>
              <DialogDescription>
                {draft.id
                  ? "This campaign has edits that have not been saved yet."
                  : "This campaign has never been saved. Leaving now discards the design."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                disabled={isSaving}
                onClick={() => {
                  setConfirmingExit(false);
                  setDirty(false);
                  setTouched(false);
                  exitWith(onExit);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Discard
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaving}
                  onClick={() => setConfirmingExit(false)}
                >
                  Keep editing
                </Button>
                <Button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void saveAndExit()}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Save and exit
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog open={startOverOpen} onOpenChange={setStartOverOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start this campaign again?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything you have written here will be discarded and you will go
              back to choosing how to design the email. The subject line and
              recipients are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep what I have</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                setStartOverOpen(false);
                exitWith(onStartOver);
              }}
            >
              Discard and start again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const PLAIN_PLACEHOLDER = [
  "Hi there,",
  "",
  "Write it the way you would write to one person. No images, no columns -",
  "just what you have to say.",
  "",
  "Thanks,",
  "Your name",
].join("\n");

const HTML_PLACEHOLDER =
  "<table width=\"100%\"><tr><td>Your markup here</td></tr></table>";

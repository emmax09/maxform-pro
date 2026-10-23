/**
 * The full-screen campaign builder.
 *
 * Designing an email needs the whole screen, so this mode replaces the
 * dashboard shell entirely — no left rail, no tab strip. The only chrome is a
 * top bar: the campaign name, the two preview toggles, Exit, and Save &
 * Continue. Finishing the design is what advances the flow, so Save & Continue
 * is the single action that hands the campaign to the send wizard.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  ArrowLeft,
  Check,
  Loader2,
  RotateCcw,
  Monitor,
  Inbox,
  Save,
  Smartphone,
  Tablet,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PaymentProduct } from "@/components/payments/payment-types";
import { cn } from "@/lib/utils";

import { CampaignBuilder } from "./CampaignBuilder";
import { useDesignHistory } from "./use-design-history";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import type {
  CampaignDesign,
  CampaignPreviewDevice,
  CampaignPreviewTheme,
} from "./campaign-blocks";

export type CampaignBuilderDraft = {
  id?: string;
  name: string;
  subject: string;
  previewText: string;
  design: CampaignDesign;
};

const AUTOSAVE_DELAY_MS = 1_200;

/**
 * Local recovery for work that has not reached the server yet — a closed tab,
 * a crash, a dropped connection.
 *
 * The key is scoped to the campaign, and an unsaved campaign gets its own
 * "new" slot, so one draft can never surface inside a different campaign. The
 * entry is removed the moment the work is safely stored or deliberately
 * discarded, rather than being left to accumulate.
 */
const draftStorageKey = (id: string | undefined) =>
  `maxform:campaign-builder-draft:${id || "new"}`;

const STALE_DRAFT_MS = 24 * 60 * 60 * 1000;

const readStoredDraft = (id: string | undefined) => {
  try {
    const raw = localStorage.getItem(draftStorageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      savedAt?: number;
      draft?: CampaignBuilderDraft;
    };
    if (!parsed?.draft) return null;
    // A day-old local copy is more likely to be a surprise than a rescue.
    if (Date.now() - Number(parsed.savedAt || 0) > STALE_DRAFT_MS) {
      localStorage.removeItem(draftStorageKey(id));
      return null;
    }
    return parsed.draft;
  } catch {
    return null;
  }
};

export function CampaignBuilderScreen({
  draft,
  onDraftChange,
  onExit,
  onSaveDraft,
  onSaveAndContinue,
  onAutosave,
  onSendTest,
  onStartOver,
  mailingAddress,
  products,
  continuing = false,
}: {
  draft: CampaignBuilderDraft;
  onDraftChange: (draft: CampaignBuilderDraft) => void;
  onExit: () => void;
  /** Explicitly stores a draft without advancing into the send wizard. */
  onSaveDraft?: (draft: CampaignBuilderDraft) => Promise<unknown> | unknown;
  onSaveAndContinue: () => void;
  /** Persists design work in the background; absent for an unsaved campaign. */
  onAutosave?: (draft: CampaignBuilderDraft) => Promise<unknown>;
  onSendTest?: () => void;
  /** Discards the design and returns to the choice of how to make one. */
  onStartOver?: () => void;
  mailingAddress: string;
  products: PaymentProduct[];
  continuing?: boolean;
}) {
  // The builder replaces the whole screen, so appearing instantly reads as a
  // glitch rather than a transition. A short mount step gives the change
  // somewhere to happen, and covers the first paint of a large design.
  const [mounted, setMounted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [startOverOpen, setStartOverOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 260);
    return () => clearTimeout(timer);
  }, []);

  /** Plays the exit before handing control back, so the screen does not snap. */
  const leaveWith = (action: () => void) => {
    setLeaving(true);
    setTimeout(action, 180);
  };

  useScrollLock(true);

  const [device, setDevice] = useState<CampaignPreviewDevice>("desktop");
  const { resolvedTheme } = useTheme();
  const theme: CampaignPreviewTheme =
    resolvedTheme === "dark" ? "dark" : "light";
  const [savedAt, setSavedAt] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [confirmingExit, setConfirmingExit] = useState(false);

  // `dirty` is the source of truth for both the save action and the exit
  // confirmation. Once an explicit save or autosave succeeds, the builder is
  // clean and leaving it must not ask the user to save the same work again.
  const [dirty, setDirty] = useState(false);
  // Autosave intentionally clears `dirty` so closing does not ask to save work
  // that already reached the server. Keep a separate session flag so a user
  // can still continue after that background save; the action remains disabled
  // on an untouched builder and after an explicit Save draft.
  const [hasEdited, setHasEdited] = useState(false);
  const changeDraft = (next: CampaignBuilderDraft) => {
    setDirty(true);
    setHasEdited(true);
    onDraftChange(next);
  };

  // The design is the undoable part of the draft; name and audience are edited
  // through their own fields and are not worth a history step.
  //
  // History owns the design while the builder is open: edits go through it, and
  // whatever it settles on — including after an undo — is pushed back onto the
  // draft below. One direction only, so the two cannot chase each other.
  const history = useDesignHistory(draft.design);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (Object.is(history.value, draftRef.current.design)) return;
    changeDraft({ ...draftRef.current, design: history.value });
    // changeDraft is recreated per render; the value is what should drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.value]);

  // Autosave is debounced against the draft itself, so typing a name or nudging
  // a block does not turn into a request per keystroke.
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const autosaveRef = useRef(onAutosave);
  autosaveRef.current = onAutosave;

  const clearStoredDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftStorageKey(draft.id));
    } catch {
      // A blocked or full localStorage is not worth failing a save over.
    }
  }, [draft.id]);

  // Local recovery: the current draft is mirrored to storage while it is
  // unsaved, and removed as soon as the server has it.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          draftStorageKey(latestDraft.current.id),
          JSON.stringify({ savedAt: Date.now(), draft: latestDraft.current }),
        );
      } catch {
        // Ignore quota failures; the server autosave is the real safety net.
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, dirty]);

  // On open, offer back anything that never made it to the server.
  const [recovered, setRecovered] = useState<CampaignBuilderDraft | null>(null);
  const offeredRecovery = useRef(false);
  useEffect(() => {
    if (offeredRecovery.current) return;
    offeredRecovery.current = true;
    const stored = readStoredDraft(draft.id);
    if (!stored) return;
    // Only worth offering when it genuinely differs from what loaded.
    if (JSON.stringify(stored) === JSON.stringify(draft)) {
      clearStoredDraft();
      return;
    }
    setRecovered(stored);
  }, [clearStoredDraft, draft]);

  // Autosave runs silently. It does not touch `saving`, which belongs to the
  // Save draft button — a background write should not spin a control the user
  // did not press.
  useEffect(() => {
    if (!onAutosave || !draft.id) return;
    const timer = setTimeout(() => {
      void Promise.resolve(autosaveRef.current?.(latestDraft.current))
        .then(() => {
          setSavedAt(
            new Date().toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
          );
          setDirty(false);
          clearStoredDraft();
        })
        .catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // The draft object identity changes on every edit, which is the signal.
  }, [clearStoredDraft, draft, onAutosave]);

  // A tab close or reload happens outside React's control, so the browser's own
  // prompt is the only thing that can intervene.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /**
   * Explicit save, for when someone wants to stop and come back rather than
   * carry on into the send wizard. Falls back to Save & Continue for a campaign
   * that has never been stored, since that is what creates the row.
   */
  const saveDraft = async () => {
    const save = onSaveDraft || (draft.id ? onAutosave : undefined);
    if (!save) {
      onSaveAndContinue();
      return;
    }
    setSaving(true);
    try {
      const result = await save(latestDraft.current);
      if (result === null || result === false) return;
      setDirty(false);
      setHasEdited(false);
      setSavedAt(
        new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
      clearStoredDraft();
    } finally {
      setSaving(false);
    }
  };

  // Both lines decide whether the email is opened at all, so neither is
  // optional. Named individually rather than as one blanket warning, so the
  // message says which field is still empty.
  const missingInboxFields = [
    draft.subject.trim() ? "" : "Subject line",
    draft.previewText.trim() ? "" : "Preview line",
  ].filter(Boolean);

  const requestExit = () => {
    if (dirty) {
      setConfirmingExit(true);
      return;
    }
    clearStoredDraft();
    leaveWith(onExit);
  };

  const saveThenExit = async () => {
    const save = onSaveDraft || (draft.id ? onAutosave : undefined);
    if (save) {
      setSaving(true);
      try {
        const result = await save(latestDraft.current);
        if (result === null || result === false) return;
        setDirty(false);
      } finally {
        setSaving(false);
      }
      setConfirmingExit(false);
      onExit();
      return;
    }
    // An unsaved campaign has no row to autosave into; Save & Continue is what
    // creates one, so that is what the prompt offers instead.
    setConfirmingExit(false);
    onSaveAndContinue();
  };

  // Escape leaves the builder the same way the Exit button does, autosaving on
  // the way out.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The settings column claims Escape first, so returning to the palette
      // never throws away the whole stage.
      if (event.key === "Escape" && !event.defaultPrevented) requestExit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    // A large centred workspace rather than a bare full-screen takeover: the
    // dimmed surround keeps the builder feeling like a focused surface you are
    // working inside, and stops a 600px email floating in an empty viewport.
    <div
      // The theme class scopes the workspace's own dark palette to the builder,
      // so every control, panel and border inside it recolours together rather
      // than one surface going dark against light chrome.
      className={cn(
        theme,
        "fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-2 backdrop-blur-xs transition-opacity duration-200 sm:p-4 lg:p-6",
        leaving ? "opacity-0" : "opacity-100",
      )}
    >
      <div
        role="region"
        aria-label="Campaign builder"
        className={cn(
          "flex h-full max-h-[min(940px,100%)] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl transition-all duration-200",
          leaving ? "scale-[.985] opacity-0" : "scale-100 opacity-100",
        )}
      >
        {/* Held until the first paint settles, so a large design does not
            appear a piece at a time. */}
        {!mounted ? (
          <div
            role="status"
            aria-label="Opening the campaign builder"
            className="flex flex-1 flex-col items-center justify-center gap-3"
          >
            <span className="relative flex h-10 w-10 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </span>
            <p className="text-[12px] font-medium text-muted-foreground">
              Opening the builder…
            </p>
          </div>
        ) : (
        <>
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <Button type="button" size="sm" variant="ghost" onClick={requestExit}>
          <ArrowLeft className="h-4 w-4" />
          Exit
        </Button>

        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="campaign-builder-name">
            Campaign name
          </label>
          <input
            id="campaign-builder-name"
            value={draft.name}
            onChange={(event) =>
              changeDraft({ ...draft, name: event.target.value })
            }
            placeholder="Untitled campaign"
            className="w-full max-w-[420px] rounded-md border border-transparent bg-transparent px-2 py-1 text-[15px] font-semibold outline-hidden transition-colors hover:border-border focus:border-primary focus:bg-background"
          />
          <p className="px-2 text-[10px] text-muted-foreground" aria-live="polite">
            {saving
              ? "Saving…"
              : savedAt
                ? `Saved ${savedAt}`
                : draft.id
                  ? "Changes save automatically"
                  : "Not saved yet"}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
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

          {onStartOver ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setStartOverOpen(true)}
              disabled={continuing}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Start from scratch
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void saveDraft()}
            disabled={saving || continuing || !dirty}
          >
            {saving ? (
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
            // Continuing without these would hand the wizard a campaign that
            // cannot be sent, so the block happens here rather than three
            // steps later.
            disabled={
              continuing || (!dirty && !hasEdited) || missingInboxFields.length > 0
            }
            title={
              missingInboxFields.length
                ? `Add the ${missingInboxFields.join(" and ").toLowerCase()} first`
                : undefined
            }
          >
            {continuing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
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


      {/* What the recipient sees in their inbox, kept in front of the person
          writing it. These two lines decide whether the email is opened at
          all, so they are not buried in a settings panel. */}
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
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Check className="h-3 w-3" />
              Ready
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            {/* The asterisk sits outside the label so it never becomes part of
                the field's accessible name. */}
            <div className="flex items-center gap-1">
              <Label
                htmlFor="campaign-subject-line"
                className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground"
              >
                Subject line
              </Label>
              <span aria-hidden="true" className="text-[11px] text-destructive">
                *
              </span>
            </div>
            <Input
              id="campaign-subject-line"
              required
              aria-invalid={!draft.subject.trim()}
              value={draft.subject}
              onChange={(event) =>
                changeDraft({ ...draft, subject: event.target.value })
              }
              placeholder="Monthly product update"
              className={cn(
                "h-9 text-[13px]",
                !draft.subject.trim() && "border-amber-500/60",
              )}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Label
                htmlFor="campaign-preview-line"
                className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground"
              >
                Preview line
              </Label>
              <span aria-hidden="true" className="text-[11px] text-destructive">
                *
              </span>
            </div>
            <Input
              id="campaign-preview-line"
              required
              aria-invalid={!draft.previewText.trim()}
              value={draft.previewText}
              onChange={(event) =>
                changeDraft({ ...draft, previewText: event.target.value })
              }
              placeholder="See what changed this month."
              className={cn(
                "h-9 text-[13px]",
                !draft.previewText.trim() && "border-amber-500/60",
              )}
            />
          </div>
        </div>
      </div>

      {recovered ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-4 py-2">
          <p className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
            Unsaved changes from your last session are still on this device.
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setRecovered(null);
              clearStoredDraft();
            }}
          >
            Discard
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              changeDraft(recovered);
              setRecovered(null);
            }}
          >
            Restore them
          </Button>
        </div>
      ) : null}

      <CampaignBuilder
        immersive
        device={device}
        onDeviceChange={setDevice}
        theme={theme}
        design={draft.design}
        onDesignChange={history.set}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        onSubjectChange={(subject) => changeDraft({ ...draft, subject })}
        onPreviewTextChange={(previewText) =>
          changeDraft({ ...draft, previewText })
        }
        onSendTest={onSendTest}
        mailingAddress={mailingAddress}
        previewText={draft.previewText}
        products={products}
        subject={draft.subject}
      />

      {/* Leaving with unsaved work is the one destructive thing this screen can
          do, so it asks — and offers to save rather than only to discard. */}
      <Dialog
        open={confirmingExit}
        onOpenChange={(open) => {
          if (!open && !saving) setConfirmingExit(false);
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
              disabled={saving}
              onClick={() => {
                setConfirmingExit(false);
                setDirty(false);
                clearStoredDraft();
                leaveWith(onExit);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Discard
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setConfirmingExit(false)}
              >
                Keep editing
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void saveThenExit()}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {draft.id ? "Save and exit" : "Save campaign"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Starting again is destructive and easy to hit by accident next to
          Save, so it asks — and says exactly what survives. */}
      <Dialog open={startOverOpen} onOpenChange={setStartOverOpen}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Start this campaign again?</DialogTitle>
            <DialogDescription>
              Everything you have designed here will be discarded and you will go
              back to choosing how to design the email. The subject line and
              recipients are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStartOverOpen(false)}
            >
              Keep what I have
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setStartOverOpen(false);
                setLeaving(true);
                window.setTimeout(() => onStartOver?.(), 260);
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Discard and start again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
        )}
      </div>
    </div>
  );
}

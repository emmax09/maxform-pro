/**
 * The workspace the editor lives in.
 *
 * Building a workflow is a task you sit inside, so it opens full-screen and the
 * surrounding dashboard chrome gets out of the way. That is a layout decision,
 * not a DOM trick: the shell renders into a fixed layer and the module keeps
 * owning the editor's state, so leaving focus mode does not remount the editor
 * or lose an in-flight edit.
 *
 * The pieces here — the opening state, the save indicator, the exit guard —
 * follow the campaign builder's established pattern so the two builders feel
 * like the same product.
 */
import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  Check,
  CircleAlert,
  Loader2,
  Maximize2,
  Minimize2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type WorkflowSaveState = "saved" | "saving" | "unsaved" | "error";

/**
 * Save status, stated once and quietly.
 *
 * Normal saving is not news, so it gets a line of text rather than a banner.
 * A *failed* save is news — it is the only state where the user's work is not
 * where they think it is — so it is the only one that takes colour.
 */
export function WorkflowSaveState({
  state,
  updatedAt,
  error,
  onRetry,
}: {
  state: WorkflowSaveState;
  updatedAt: string;
  error?: string;
  onRetry?: () => void;
}) {
  if (state === "error") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-destructive">
        <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
        <span aria-live="polite">{error || "Save failed"}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded underline underline-offset-2 hover:no-underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-destructive/30"
          >
            Retry
          </button>
        )}
      </span>
    );
  }
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        <span aria-live="polite">Saving…</span>
      </span>
    );
  }
  if (state === "unsaved") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          className="h-1.5 w-1.5 rounded-full bg-amber-500"
          aria-hidden="true"
        />
        Unsaved changes
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Check className="h-3 w-3" aria-hidden="true" />
      {updatedAt ? `Saved ${updatedAt}` : "Saved"}
    </span>
  );
}

/**
 * Shown while the workflow and the editor's dependencies settle.
 *
 * Not a timed splash — the caller clears it the moment the data is there, so a
 * cached workflow goes straight through. It exists because dropping someone
 * into a half-built canvas reads as breakage.
 */
export function WorkflowOpeningState({
  name,
  error,
  onRetry,
  onCancel,
}: {
  name?: string;
  error?: string;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </span>
        <div>
          <p className="text-[14px] font-medium">This workflow could not be opened</p>
          <p className="mt-0.5 max-w-[380px] text-[12.5px] text-muted-foreground">
            {error}
          </p>
        </div>
        <div className="flex gap-2">
          {onRetry && (
            <Button type="button" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
          {onCancel && (
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Back to workflows
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-label="Opening workflow"
      className="flex flex-1 flex-col items-center justify-center gap-3"
    >
      <span className="relative flex h-10 w-10 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </span>
      <p className="text-[12px] font-medium text-muted-foreground">
        {name ? `Opening ${name}…` : "Opening workflow…"}
      </p>
    </div>
  );
}

/**
 * The unsaved-changes gate.
 *
 * Save & Exit deliberately does not close on its own — the caller reports
 * whether the save actually landed, and a failed save keeps the editor open
 * with the error visible rather than discarding work while claiming to save it.
 */
export function WorkflowExitDialog({
  open,
  saving,
  error,
  onSaveAndExit,
  onDiscard,
  onContinue,
}: {
  open: boolean;
  saving: boolean;
  error?: string;
  onSaveAndExit: () => void;
  onDiscard: () => void;
  onContinue: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onContinue(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Save your changes?</DialogTitle>
          <DialogDescription>
            This workflow has changes that have not been saved. Leaving now
            discards them.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-[12.5px] text-destructive">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onContinue}>
            Continue editing
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={onDiscard}
          >
            Discard changes
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={onSaveAndExit}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save &amp; exit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Focus mode covers the dashboard; restored keeps the module's chrome visible. */
export function WorkflowFocusToggle({
  focused,
  onToggle,
}: {
  focused: boolean;
  onToggle: () => void;
}) {
  const label = focused ? "Exit full screen" : "Enter full screen";
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggle}
            aria-label={label}
            aria-pressed={focused}
          >
            {focused ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * The editor's container.
 *
 * In focus mode this is a fixed layer over the dashboard; restored, it is an
 * ordinary block in the page. Both render the same children from the same
 * component instance, so toggling is a class change rather than a remount —
 * the canvas, the selection and any unsaved edit all survive it.
 */
export function WorkflowEditorShell({
  focused,
  onRequestExit,
  children,
}: {
  focused: boolean;
  onRequestExit: () => void;
  children: React.ReactNode;
}) {
  const exitRef = useRef(onRequestExit);
  exitRef.current = onRequestExit;

  // Escape leaves the editor, through the same guard as the Back control, so
  // it can never be the one path that drops unsaved work.
  useEffect(() => {
    if (!focused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A dialog or popover on top owns Escape first; only handle it when the
      // editor itself is the frontmost surface.
      if (document.querySelector("[role='dialog'],[role='alertdialog']")) return;
      exitRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focused]);

  // The page behind must not scroll while a fixed layer is over it.
  useEffect(() => {
    if (!focused) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [focused]);

  if (!focused) {
    // Bounded, not auto-height: the editor's panels scroll inside their own
    // column, so restoring the workspace cannot stretch the dashboard into a
    // page several screens tall that scrolls the node library out of reach.
    return (
      <div className="flex h-[calc(100vh-13rem)] min-h-[520px] flex-col overflow-hidden rounded-lg border border-border">
        {children}
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Workflow editor"
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-background text-foreground",
        "duration-200 animate-in fade-in-0",
      )}
    >
      {children}
    </div>
  );
}

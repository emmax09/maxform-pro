/**
 * An action the assistant has proposed and nobody has approved yet.
 *
 * Nothing behind this card has run. The server holds the action as a row and
 * only executes it when Approve is pressed, so the card is the action rather
 * than a receipt for one -- which is why it states what will happen in future
 * tense and never disappears on its own.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AssistantError,
  confirmAssistantAction,
  declineAssistantAction,
  notifyWorkspaceChanged,
  type PendingConfirmation,
} from "@/lib/ai-assistant";

/** Reads `send_email` as "Send email" without needing a label per action. */
const describeAction = (actionType: string) =>
  actionType
    .replace(/_/g, " ")
    .replace(/^./, (character) => character.toUpperCase());

export function ConfirmationCard({
  confirmation,
  onSettled,
}: {
  confirmation: PendingConfirmation;
  onSettled: (
    id: string,
    outcome: "confirmed" | "declined",
    message: string,
  ) => void;
}) {
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  const settle = async (outcome: "confirmed" | "declined") => {
    if (busy) return;
    setBusy(outcome === "confirmed" ? "confirm" : "decline");
    setError("");
    try {
      if (outcome === "confirmed") {
        const result = await confirmAssistantAction(confirmation.id);
        notifyWorkspaceChanged(result.workspaceChanges || []);
        if (result.workspaceChanges?.length) {
          void queryClient.invalidateQueries();
        }
        const change = result.workspaceChanges?.[0];
        onSettled(
          confirmation.id,
          "confirmed",
          change
            ? `${change.label} was created in ${change.module}.`
            : "Done.",
        );
      } else {
        await declineAssistantAction(confirmation.id);
        onSettled(confirmation.id, "declined", "Cancelled — nothing was sent.");
      }
    } catch (caught) {
      // The card stays put on failure. A send that did not happen must not
      // look like one that did.
      setError(
        caught instanceof AssistantError
          ? caught.message
          : "That could not be completed.",
      );
      setBusy(null);
    }
  };

  return (
    <div
      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3"
      role="group"
      aria-label="Action awaiting your approval"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-foreground">
            {describeAction(confirmation.actionType)} — needs your approval
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {confirmation.summary}
          </p>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11.5px] text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 px-2.5 text-[12px]"
          onClick={() => settle("confirmed")}
          disabled={busy !== null}
        >
          {busy === "confirm" ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1 h-3.5 w-3.5" />
          )}
          Approve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2.5 text-[12px]"
          onClick={() => settle("declined")}
          disabled={busy !== null}
        >
          {busy === "decline" ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="mr-1 h-3.5 w-3.5" />
          )}
          Cancel
        </Button>
      </div>
    </div>
  );
}

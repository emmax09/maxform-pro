/**
 * The floating assistant.
 *
 * Mounted once at the dashboard shell, not per module, so it follows the
 * person instead of the other way around: they can ask "why did this payment
 * fail" without leaving the Payments screen, and the conversation survives
 * switching tabs.
 *
 * This component owns everything with a consequence -- the requests, the
 * conversation id, the pending approvals. AssistantPanel only renders.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, X } from "lucide-react";
import { toast } from "sonner";

import { StackedLogo } from "@/components/StackedLogo";
import { cn } from "@/lib/utils";
import {
  AssistantError,
  loadAssistantCapabilities,
  loadAssistantConversation,
  notifyWorkspaceChanged,
  saveGeneration,
  sendAssistantMessage,
  type AssistantScreenContext,
  type AssistantSurface,
  type PendingConfirmation,
} from "@/lib/ai-assistant";

import { useAssistantController } from "./assistant-controller";
import {
  AssistantPanel,
  type AssistantPanelView,
  type PanelTurn,
} from "./AssistantPanel";
import { ConfirmationCard } from "./ConfirmationCard";

let turnCounter = 0;
const nextTurnId = () => {
  turnCounter += 1;
  return `turn-${turnCounter}`;
};

export function FloatingAssistant({
  context,
  surface = "floating",
  fullName,
  workspaceLogo,
  onOpenSettings,
}: {
  /** What the person is looking at, recomputed by the shell as they navigate. */
  context: AssistantScreenContext;
  surface?: AssistantSurface;
  /** Used only for the greeting on the home screen. */
  fullName?: string;
  /** The workspace identity image used for person-side message avatars. */
  workspaceLogo?: string | null;
  /** Lets the shell take an unavailable provider straight to MaxAI settings. */
  onOpenSettings?: () => void;
}) {
  const firstName = (fullName || "").trim().split(/\s+/)[0] || "";
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<AssistantPanelView>("home");
  const [turns, setTurns] = useState<PanelTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingConfirmations, setPendingConfirmations] = useState<
    PendingConfirmation[]
  >([]);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [teaserVisible, setTeaserVisible] = useState(true);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const queryClient = useQueryClient();

  /**
   * Requests read the conversation from this ref, not from state.
   *
   * Starting a fresh conversation and sending its first message happen in one
   * go, and a state update is not visible until the next render -- so a `send`
   * closed over state would post the new message onto the conversation the
   * person just left.
   */
  const conversationIdRef = useRef<string | null>(null);
  const lastMessageRef = useRef("");
  const requestInFlightRef = useRef(false);
  const setConversation = useCallback((id: string | null) => {
    conversationIdRef.current = id;
    setConversationId(id);
  }, []);

  // Only asked once the panel is opened: an assistant nobody opened should
  // cost nothing.
  const capabilities = useQuery({
    queryKey: ["ai-assistant", "capabilities"],
    queryFn: loadAssistantCapabilities,
    enabled: open,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Escape closes the panel and returns focus to the launcher, so keyboard
  // users are not stranded inside it.
  useEffect(() => {
    if (!open) return;
    setTeaserVisible(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        launcherRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const send = useCallback(
    async (message: string) => {
      const normalizedMessage = message.trim();
      if (!normalizedMessage || requestInFlightRef.current) return;
      requestInFlightRef.current = true;
      lastMessageRef.current = normalizedMessage;
      setView("chat");
      setError("");
      setErrorCode("");
      const userTurn: PanelTurn = {
        id: nextTurnId(),
        role: "user",
        text: normalizedMessage,
        pending: true,
      };
      setTurns((current) => [...current, userTurn]);
      setThinking(true);
      try {
        const result = await sendAssistantMessage({
          message: normalizedMessage,
          conversationId: conversationIdRef.current,
          surface,
          context,
        });
        setConversation(result.conversationId);
        setTurns((current) => [
          ...current.map((turn) =>
            turn.id === userTurn.id ? { ...turn, pending: false } : turn,
          ),
          ...(result.message
            ? [
                {
                  id: nextTurnId(),
                  role: "assistant" as const,
                  text: result.message,
                  messageId: result.messageId || undefined,
                },
              ]
            : []),
        ]);
        // Replaces rather than appends: the server returns everything still
        // awaiting a decision, so a stale card cannot linger.
        setPendingConfirmations(result.pendingConfirmations);
        notifyWorkspaceChanged(result.workspaceChanges || []);
        if (result.workspaceChanges?.length) {
          void queryClient.invalidateQueries();
        }
      } catch (caught) {
        setTurns((current) =>
          current.filter((turn) => turn.id !== userTurn.id),
        );
        if (caught instanceof AssistantError) {
          setError(caught.message);
          setErrorCode(caught.code);
        } else {
          setError("MaxAI could not answer that. Try again.");
          setErrorCode("ai_error");
        }
      } finally {
        requestInFlightRef.current = false;
        setThinking(false);
      }
    },
    [context, queryClient, setConversation, surface],
  );

  const retryLastMessage = useCallback(() => {
    if (requestInFlightRef.current || !lastMessageRef.current) return;
    void send(lastMessageRef.current);
  }, [send]);

  /**
   * Opens a past conversation in the panel. The transcript is re-read from the
   * server rather than trusted from whoever asked, and any approval still
   * outstanding comes back with it -- an action proposed yesterday is still
   * waiting today.
   */
  const resume = useCallback(
    async (id: string) => {
      setView("chat");
      setError("");
      setErrorCode("");
      setConversation(id);
      setTurns([]);
      setPendingConfirmations([]);
      setThinking(true);
      try {
        const conversation = await loadAssistantConversation(id);
        setTurns(
          conversation.messages.map((message) => ({
            id: message.id,
            role: message.role,
            text: message.content,
            // A stored message is its own id, so a past answer can be kept too.
            messageId: message.role === "assistant" ? message.id : undefined,
          })),
        );
        setPendingConfirmations(conversation.pendingConfirmations);
      } catch (caught) {
        if (caught instanceof AssistantError) {
          setError(caught.message);
          setErrorCode(caught.code);
        } else {
          setError("That conversation could not be opened.");
          setErrorCode("ai_error");
        }
      } finally {
        setThinking(false);
      }
    },
    [setConversation],
  );

  // The AI Workspace tab drives the assistant through this: open with a
  // prompt already typed, or reopen a past conversation.
  const controller = useAssistantController();
  useEffect(() => {
    controller.register((command) => {
      setOpen(true);
      setTeaserVisible(false);
      if (command.conversationId) {
        void resume(command.conversationId);
        return;
      }
      if (command.prompt) {
        setView("chat");
        if (command.send !== false) {
          setConversation(null);
          setTurns([]);
          setPendingConfirmations([]);
          void send(command.prompt);
        }
      }
    });
    return () => controller.register(null);
  }, [controller, resume, send, setConversation]);

  /**
   * An approval decision resolved. The card goes, and the outcome is written
   * into the thread as an assistant turn so the transcript records what the
   * person chose rather than the card silently vanishing.
   */
  const settleConfirmation = useCallback(
    (id: string, _outcome: "confirmed" | "declined", message: string) => {
      setPendingConfirmations((current) =>
        current.filter((entry) => entry.id !== id),
      );
      setTurns((current) => [
        ...current,
        { id: nextTurnId(), role: "assistant", text: message },
      ]);
    },
    [],
  );

  /**
   * Keeps one answer. Only the id travels: the server copies the text from
   * its own row, so what lands in Saved is what the assistant actually said.
   */
  const save = useCallback(
    async (turn: PanelTurn) => {
      if (!turn.messageId || turn.saved) return;
      try {
        await saveGeneration({ messageId: turn.messageId });
        setTurns((current) =>
          current.map((entry) =>
            entry.id === turn.id ? { ...entry, saved: true } : entry,
          ),
        );
        void queryClient.invalidateQueries({
          queryKey: ["ai-assistant", "generations"],
        });
        toast.success("Saved to MaxAI.");
      } catch (caught) {
        toast.error(
          caught instanceof AssistantError
            ? caught.message
            : "That could not be saved.",
        );
      }
    },
    [queryClient],
  );

  // A failed capabilities call means the endpoint is unreachable, which is
  // the same practical state as "not configured" for the person.
  const checking = capabilities.isLoading && !capabilities.data;
  const unavailable =
    !checking && (capabilities.isError || capabilities.data?.available === false);

  const openSettings = useCallback(() => {
    setOpen(false);
    if (onOpenSettings) {
      onOpenSettings();
      return;
    }
    // Focused embeds may not have the Dashboard callback. Keep the fallback
    // useful without coupling this component to a router instance.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "ai");
      url.searchParams.set("section", "settings");
      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [onOpenSettings]);

  const closeConversation = useCallback(() => {
    setConversation(null);
    lastMessageRef.current = "";
    setTurns([]);
    setPendingConfirmations([]);
    setError("");
    setErrorCode("");
    setThinking(false);
    setView("home");
  }, [setConversation]);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2.5 print:hidden">
        {open ? (
          <AssistantPanel
            context={context}
            greeting={firstName}
            view={view}
            turns={turns}
            thinking={thinking}
            checking={checking}
            unavailable={unavailable}
            availabilityReason={capabilities.data?.reason}
            error={error}
            errorCode={errorCode}
            pendingConfirmations={pendingConfirmations}
            workspaceLogo={workspaceLogo}
            onSend={send}
            onOpenChat={() => setView("chat")}
            onBackHome={() => setView("home")}
            onCloseConversation={closeConversation}
            onSave={save}
            onRetry={() => void capabilities.refetch()}
            onRetryMessage={retryLastMessage}
            onConfigure={openSettings}
            onClose={() => {
              setOpen(false);
              launcherRef.current?.focus();
            }}
            renderConfirmation={(confirmation) => (
              <ConfirmationCard
                confirmation={confirmation}
                onSettled={settleConfirmation}
              />
            )}
          />
        ) : null}

        {!open && teaserVisible ? (
          <button
            type="button"
            onClick={() => {
              setTeaserVisible(false);
              setOpen(true);
            }}
            aria-label="Ask MaxAI about this screen"
            className="group relative flex max-w-[244px] items-center gap-2 rounded-[14px] border border-primary/20 bg-background/95 px-2.5 py-2 text-left shadow-lg shadow-black/10 backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
              <StackedLogo size={15} color="currentColor" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold tracking-[-0.01em] text-foreground">
                {unavailable ? "MaxAI needs a connection" : "Need a hand?"}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                {unavailable
                  ? "Open the assistant to configure it"
                  : "Ask about this screen"}
              </span>
            </span>
            <MessageCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:text-primary" />
            <span
              aria-hidden="true"
              className="absolute -bottom-1.5 right-4 h-3 w-3 rotate-45 border-b border-r border-primary/20 bg-background"
            />
          </button>
        ) : null}

        <button
          ref={launcherRef}
          type="button"
          onClick={() => {
            setTeaserVisible(false);
            setOpen((value) => !value);
          }}
          aria-expanded={open}
          aria-label={open ? "Close MaxAI" : "Open MaxAI"}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-[14px] bg-primary text-primary-foreground shadow-md shadow-primary/25 ring-2 ring-background/80 transition",
            "hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
        >
          {open ? (
            <X className="h-4 w-4" />
          ) : (
            <StackedLogo size={17} color="currentColor" />
          )}
        </button>
      </div>
    </>
  );
}

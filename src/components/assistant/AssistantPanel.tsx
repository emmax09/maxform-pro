/**
 * The assistant panel.
 *
 * FloatingAssistant owns requests and conversation state. This component is a
 * focused renderer: a branded workspace home, a readable chat transcript, and
 * a composer that makes the current scope and sending state obvious.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  Bookmark,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  X,
  MessageSquareX,
} from "lucide-react";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  AssistantScreenContext,
  PendingConfirmation,
} from "@/lib/ai-assistant";

import { AssistantHome } from "./AssistantHome";
import { AssistantRichText } from "./AssistantRichText";

export type PanelTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  messageId?: string;
  saved?: boolean;
};

export type AssistantPanelView = "home" | "chat";

export function AssistantMessageAvatar({
  role,
  workspaceLogo,
}: {
  role: PanelTurn["role"];
  workspaceLogo?: string | null;
}) {
  if (role === "user") {
    return (
      <Avatar
        className="mt-0.5 h-7 w-7 shrink-0 rounded-xl ring-1 ring-inset ring-border"
        role="img"
        aria-label="Workspace identity"
      >
        {workspaceLogo ? (
          <AvatarImage
            src={workspaceLogo}
            alt="Workspace identity"
            className="object-cover"
          />
        ) : null}
        <AvatarFallback className="rounded-xl bg-muted text-[10px] font-semibold text-muted-foreground">
          W
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <span
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-inset ring-primary/15"
      role="img"
      aria-label="MaxAI"
    >
      <BrandLogo markSize={16} showWordmark={false} />
    </span>
  );
}

const moduleLabels: Record<string, string> = {
  home: "Home",
  analytics: "Analytics",
  projects: "Projects",
  crm: "CRM",
  campaigns: "Campaigns",
  forms: "Forms",
  events: "Events",
  appointments: "Appointments",
  workflows: "Workflows",
  files: "Files",
  documents: "Documents",
  payments: "Payments",
  orders: "Orders",
  ai: "MaxAI",
  emails: "Email",
  integrations: "Integrations",
  settings: "Settings",
};

/** Makes the context boundary legible before the person sends a message. */
export function ContextChip({ context }: { context: AssistantScreenContext }) {
  const module = context.module
    ? moduleLabels[context.module] || context.module
    : "";
  const record = context.recordType
    ? `${context.recordType}${context.recordId ? " open" : ""}`
    : "";

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 text-[10.5px] text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/6 px-2 py-0.5 font-medium text-primary">
        <CheckCircle2 className="h-3 w-3" />
        Workspace only
      </span>
      {module ? (
        <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 font-medium text-foreground">
          {module}
          {context.section ? ` / ${context.section}` : ""}
        </span>
      ) : null}
      {record ? (
        <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5">
          {record}
        </span>
      ) : null}
      <span>{module ? "is in view" : "Live workspace context"}</span>
    </div>
  );
}

function MessageBubble({
  turn,
  onSave,
  workspaceLogo,
}: {
  turn: PanelTurn;
  onSave?: (turn: PanelTurn) => void;
  workspaceLogo?: string | null;
}) {
  const isUser = turn.role === "user";
  const canSave = !isUser && Boolean(turn.messageId) && Boolean(onSave);

  return (
    <div
      className={cn(
        "group flex items-end gap-2.5",
        isUser && "flex-row-reverse",
      )}
    >
      <AssistantMessageAvatar role={turn.role} workspaceLogo={workspaceLogo} />
      <div className={cn("min-w-0 max-w-[86%]", isUser && "items-end")}>
        <div
          className={cn(
            "mb-1 flex items-center gap-1.5 px-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
            isUser && "justify-end",
          )}
        >
          <span>{isUser ? "You" : "MaxAI"}</span>
          {turn.pending ? (
            <span className="inline-flex items-center gap-1 font-medium normal-case tracking-normal text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              Sending
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "rounded-[18px] px-3.5 py-2.5 text-[13px] leading-[1.55] shadow-[0_5px_18px_-14px_rgba(15,23,42,0.45)]",
            isUser
              ? "rounded-br-[6px] bg-primary text-primary-foreground"
              : "rounded-bl-[6px] border border-border/90 bg-card text-foreground",
            turn.pending && "opacity-70",
          )}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap">{turn.text}</span>
          ) : (
            <AssistantRichText content={turn.text} />
          )}
        </div>
        {canSave ? (
          <button
            type="button"
            onClick={() => onSave?.(turn)}
            disabled={turn.saved}
            className={cn(
              "mt-1.5 flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10.5px] transition",
              turn.saved
                ? "text-muted-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Bookmark
              className={cn("h-3 w-3", turn.saved && "fill-current")}
              aria-hidden
            />
            {turn.saved ? "Saved" : "Save answer"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AssistantPanel({
  context,
  greeting,
  view = "home",
  turns,
  thinking,
  checking = false,
  unavailable,
  availabilityReason,
  error,
  errorCode,
  pendingConfirmations,
  workspaceLogo,
  onSend,
  onOpenChat,
  onBackHome,
  onCloseConversation,
  onClose,
  onRetry,
  onRetryMessage,
  onConfigure,
  onSave,
  renderConfirmation,
}: {
  context: AssistantScreenContext;
  greeting?: string;
  view?: AssistantPanelView;
  turns: PanelTurn[];
  thinking: boolean;
  checking?: boolean;
  unavailable: boolean;
  availabilityReason?: string;
  error: string;
  errorCode?: string;
  pendingConfirmations: PendingConfirmation[];
  workspaceLogo?: string | null;
  onSend: (message: string) => void;
  onOpenChat: () => void;
  onBackHome: () => void;
  onCloseConversation: () => void;
  onClose: () => void;
  onRetry?: () => void;
  onRetryMessage?: () => void;
  onConfigure?: () => void;
  onSave?: (turn: PanelTurn) => void;
  renderConfirmation?: (confirmation: PendingConfirmation) => ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (view === "chat") {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [view, turns.length, thinking, pendingConfirmations.length]);

  useEffect(() => {
    if (view === "chat") inputRef.current?.focus();
  }, [view]);

  const submit = () => {
    const message = draft.trim();
    if (!message || thinking || checking || unavailable) return;
    onSend(message);
    setDraft("");
  };

  const blocked = checking || unavailable;
  const closeConversation = () => {
    setDraft("");
    onCloseConversation();
  };

  return (
    <div
      role="dialog"
      aria-label="MaxAI workspace assistant"
      className="flex h-[min(720px,calc(100vh-4.5rem))] w-[min(460px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[28px] border border-border/80 bg-background/95 shadow-[0_28px_80px_-28px_rgba(15,23,42,0.42)] backdrop-blur-sm"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/80 bg-linear-to-r from-primary/8 via-background/95 to-background/95 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {view === "chat" ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-lg"
              onClick={onBackHome}
              aria-label="Back to MaxAI home"
              title="Back to MaxAI home"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-primary/20 bg-background/80 text-primary shadow-xs">
            <BrandLogo markSize={19} showWordmark={false} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold tracking-[-0.015em]">
              MaxAI
            </p>
            <p className="truncate text-[10.5px] text-muted-foreground">
              {view === "home"
                ? "Workspace intelligence"
                : "Live workspace conversation"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/6 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 sm:inline-flex">
            <ShieldCheck className="h-3 w-3" />
            Workspace scoped
          </span>
          {view === "chat" ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={closeConversation}
              aria-label="Close conversation"
              title="Close conversation"
            >
              <MessageSquareX className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close assistant"
            title="Close assistant"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="shrink-0 border-b border-border/80">
        <ContextChip context={context} />
      </div>

      <div
        className="flex-1 space-y-4 overflow-y-auto bg-linear-to-b from-muted/18 via-background to-background px-3.5 py-4 sm:px-5 sm:py-5"
        aria-busy={checking || thinking}
      >
        {checking ? (
          <div className="rounded-[20px] border border-primary/20 bg-card/80 p-4 text-[12px] text-muted-foreground shadow-xs">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Connecting to MaxAI...
            </div>
            <p className="mt-1 pl-6">Checking this workspace connection.</p>
          </div>
        ) : unavailable ? (
          <div className="rounded-[20px] border border-amber-500/30 bg-amber-500/6 p-4 text-[12px] text-muted-foreground shadow-xs">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
              <div>
                <p className="font-medium text-foreground">
                  MaxAI is not switched on for this workspace yet.
                </p>
                <p className="mt-1">
                  {availabilityReason ||
                    "Connect an AI provider in MaxAI Settings. Your API key stays server-side."}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {onConfigure ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2 text-[11.5px]"
                      onClick={onConfigure}
                    >
                      <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                      Open AI settings
                    </Button>
                  ) : null}
                  {onRetry ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11.5px]"
                      onClick={onRetry}
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Retry connection
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {view === "home" ? (
          <AssistantHome
            context={context}
            greeting={greeting}
            checking={checking}
            unavailable={unavailable}
            hasConversation={turns.length > 0}
            onOpenChat={onOpenChat}
            onPick={(suggestion) => onSend(suggestion)}
          />
        ) : (
          <>
            {!checking && !unavailable && turns.length === 0 ? (
              <div className="flex min-h-[270px] flex-col items-center justify-center rounded-[24px] border border-border/80 bg-card/75 px-6 text-center shadow-xs">
                <span className="flex h-14 w-14 items-center justify-center rounded-[18px] border border-primary/20 bg-primary/[0.07] text-primary shadow-xs">
                  <BrandLogo markSize={24} showWordmark={false} />
                </span>
                <p className="mt-4 text-[14px] font-semibold tracking-[-0.01em] text-foreground">
                  Chat with MaxAI
                </p>
                <p className="mt-1.5 max-w-[275px] text-[12px] leading-relaxed text-muted-foreground">
                  Ask about {context.module || "your workspace"}, or tell me
                  what you want to create.
                </p>
              </div>
            ) : null}

            {turns.map((turn) => (
              <MessageBubble
                key={turn.id}
                turn={turn}
                onSave={onSave}
                workspaceLogo={workspaceLogo}
              />
            ))}

            {pendingConfirmations.map((confirmation) =>
              renderConfirmation ? (
                <div key={confirmation.id}>{renderConfirmation(confirmation)}</div>
              ) : null,
            )}

            {thinking ? (
              <div
                className="flex items-start gap-2.5"
                role="status"
              >
                <AssistantMessageAvatar role="assistant" />
                <div className="rounded-[18px] rounded-bl-[6px] border border-border/90 bg-card px-3.5 py-2.5 shadow-xs">
                  <div className="flex items-center gap-2 text-[11.5px] font-medium text-muted-foreground">
                    <span className="flex gap-1" aria-hidden="true">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:120ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:240ms]" />
                    </span>
                    MaxAI is working with your workspace...
                  </div>
                </div>
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="rounded-[16px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-[12px] text-destructive"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 leading-relaxed">{error}</p>
                  {errorCode !== "ai_quota_exceeded" && onRetryMessage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-mr-1 -mt-1 h-7 shrink-0 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={onRetryMessage}
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Try again
                    </Button>
                  ) : null}
                </div>
                {errorCode === "ai_quota_exceeded" && onConfigure ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 border-destructive/30 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={onConfigure}
                  >
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                    Open AI settings
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        <div ref={endRef} />
      </div>

      {view === "chat" ? (
        <div className="shrink-0 border-t border-border/80 bg-background/95 px-3.5 pb-3.5 pt-2.5">
          <div className="rounded-[22px] border border-border bg-card p-2 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.55)] transition focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/10">
            <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                <ShieldCheck className="h-3 w-3" />
                Workspace chat
              </span>
              <span className="text-[10px] text-muted-foreground">
                Enter to send · Shift + Enter for a line
              </span>
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  checking
                    ? "Connecting to MaxAI..."
                    : unavailable
                      ? "Open AI settings to connect MaxAI"
                      : "Ask about your workspace..."
                }
                disabled={blocked}
                aria-label="Message MaxAI"
                rows={1}
                className="max-h-32 min-h-[42px] resize-none border-0 bg-transparent px-2 py-2.5 text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
              />
              <Button
                size="icon"
                className="h-10 w-10 shrink-0 rounded-[14px] shadow-xs"
                onClick={submit}
                disabled={!draft.trim() || thinking || blocked}
                aria-label="Send message"
              >
                {thinking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <p className="mt-1.5 px-1 text-[10px] leading-4 text-muted-foreground">
            MaxAI only uses data and actions available in this workspace. Consequential actions pause for approval.
          </p>
        </div>
      ) : null}
    </div>
  );
}

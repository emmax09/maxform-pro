/**
 * The branded landing view for the floating assistant.
 *
 * The landing view is deliberately not a chat box. It makes the scope and
 * safety model obvious before somebody starts a conversation, then gives
 * them a small set of useful, screen-aware starting points.
 */
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssistantScreenContext } from "@/lib/ai-assistant";

import { suggestionsFor } from "./assistant-suggestions";

export function AssistantHome({
  context,
  greeting,
  onPick,
  onOpenChat,
  checking = false,
  unavailable = false,
  hasConversation = false,
}: {
  context: AssistantScreenContext;
  greeting?: string;
  onPick: (prompt: string) => void;
  onOpenChat: () => void;
  checking?: boolean;
  unavailable?: boolean;
  hasConversation?: boolean;
}) {
  const suggestions = suggestionsFor(context);
  const moduleName = context.module || "workspace";
  const scopeName = context.section
    ? `${moduleName} / ${context.section}`
    : moduleName;
  const disabled = unavailable;

  return (
    <div className="flex flex-col gap-3.5" aria-label="Assistant home">
      <section className="relative overflow-hidden rounded-[24px] border border-primary/20 bg-gradient-to-br from-primary/[0.14] via-background to-background shadow-sm">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-primary/20 bg-background/90 text-primary shadow-sm">
                <BrandLogo markSize={23} showWordmark={false} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                  MaxAI
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                  Workspace intelligence
                </p>
              </div>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium",
                unavailable
                  ? "border-amber-500/30 bg-amber-500/[0.07] text-amber-700 dark:text-amber-300"
                  : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  checking
                    ? "animate-pulse bg-amber-500"
                    : unavailable
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
              />
              {checking ? "Checking" : unavailable ? "Needs setup" : "Ready"}
            </span>
          </div>

          <h2 className="mt-5 text-[21px] font-semibold leading-tight tracking-[-0.025em] text-foreground">
            {greeting
              ? `Hi ${greeting}, how can I help you build today?`
              : "How can I help you build today?"}
          </h2>
          <p className="mt-2 max-w-[320px] text-[12.5px] leading-relaxed text-muted-foreground">
            Ask about live workspace data, make sense of a module, or turn an
            idea into a draft you can review before it is applied.
          </p>

          <Button
            type="button"
            onClick={onOpenChat}
            className="mt-4 h-10 w-full justify-between rounded-xl px-3.5 text-[12.5px] shadow-sm"
          >
            <span className="inline-flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              {hasConversation ? "Continue conversation" : "Open chat"}
            </span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card/75 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              AI context
            </p>
            <p className="mt-1 text-[12.5px] font-medium text-foreground">
              Live context available to MaxAI right now
            </p>
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/[0.08] text-primary">
            <CheckCircle2 className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-muted/45 px-2.5 py-2">
            <p className="text-[10px] font-medium text-muted-foreground">Context</p>
            <p className="mt-1 truncate text-[11px] font-semibold text-foreground">Live</p>
          </div>
          <div className="rounded-xl bg-muted/45 px-2.5 py-2">
            <p className="text-[10px] font-medium text-muted-foreground">Scope</p>
            <p className="mt-1 truncate text-[11px] font-semibold text-foreground">Workspace</p>
          </div>
          <div className="rounded-xl bg-muted/45 px-2.5 py-2">
            <p className="text-[10px] font-medium text-muted-foreground">Actions</p>
            <p className="mt-1 truncate text-[11px] font-semibold text-foreground">Reviewed</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-card/80 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
            In view
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {scopeName}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card/80 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <Clock3 className="h-3.5 w-3.5 text-primary" />
            Always current
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Fresh workspace context per message
          </p>
        </div>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Quick starts
          </p>
          <span className="text-[10.5px] text-muted-foreground">{scopeName}</span>
        </div>
        <button
          type="button"
          onClick={() => onPick("Give me a live overview of this workspace")}
          disabled={disabled}
          className="group mb-1.5 flex w-full items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.05] px-3 py-2.5 text-left text-[12.5px] text-foreground transition hover:border-primary/40 hover:bg-primary/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Give me a live workspace overview</span>
            <span className="mt-0.5 block text-[10.5px] text-muted-foreground">See what is active and what needs attention</span>
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary transition group-hover:translate-x-0.5" />
        </button>
        <div className="flex flex-col gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onPick(suggestion)}
              disabled={disabled}
              className={cn(
                "group flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-[12.5px] text-foreground transition",
                "hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{suggestion}</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:text-primary" />
            </button>
          ))}
        </div>
      </section>

      <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          Workspace only. I use live data you can access, and I ask before
          anything gets sent, charged, published, or deleted.
        </span>
      </p>
    </div>
  );
}

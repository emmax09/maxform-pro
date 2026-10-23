/**
 * AI Creator.
 *
 * A conversation rather than a form: you describe the campaign, it drafts one,
 * and you refine it by saying what to change. Each draft arrives as a card in
 * the thread with a preview and an "open in builder" action, so the history of
 * what was tried stays visible instead of being overwritten.
 *
 * The drafting itself runs locally today (see campaign-ai.ts). `onGenerate` is
 * the only seam that touches a model, so pointing it at Gemini later is a
 * change to one function rather than to this screen.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Loader2, MessageSquare, RefreshCw, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { CampaignThumbnail } from "./CampaignPreview";
import { formatHourLabel } from "./campaign-format";
import type { CampaignDraft, SubjectQuality } from "./campaign-ai";
import { campaignCategoryLabels } from "./campaign-templates";

const suggestions = [
  "Announce our summer sale — 20% off, ends Friday",
  "Win back customers who have not ordered in 60 days",
  "Invite subscribers to our product webinar on Thursday",
  "Monthly newsletter recapping what shipped in March",
];

const qualityClass = (quality: SubjectQuality) =>
  quality === "Strong"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : quality === "Good"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
      : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";

export type AiTurn =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; draft?: CampaignDraft };

export function CampaignAiChat({
  turns,
  thinking,
  onSend,
  onApply,
  onReset,
}: {
  turns: AiTurn[];
  thinking: boolean;
  onSend: (prompt: string) => void;
  onApply: (draft: CampaignDraft, subject: string) => void;
  onReset: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  // Follow the newest turn, the way a chat is expected to behave.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, thinking]);

  const submit = () => {
    const text = prompt.trim();
    if (!text || thinking) return;
    onSend(text);
    setPrompt("");
  };

  return (
    <div className="flex min-h-[560px] flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">Campaign assistant</p>
          <p className="text-[10.5px] text-muted-foreground">
            Describe a campaign and it drafts one you can open in the builder.
          </p>
        </div>
        {turns.length ? (
          <Button type="button" size="sm" variant="ghost" onClick={onReset}>
            <RefreshCw className="h-3.5 w-3.5" />
            New chat
          </Button>
        ) : null}
      </header>

      <div className="dashboard-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {!turns.length ? (
          <div className="mx-auto flex max-w-[520px] flex-col items-center py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MessageSquare className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-[16px] font-semibold tracking-tight">
              What should this campaign do?
            </h3>
            <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
              Say it the way you would to a colleague. Mention the offer, who it
              is for, and any deadline.
            </p>
            <div className="mt-5 grid w-full gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onSend(suggestion)}
                  className="rounded-lg border border-border px-3.5 py-2.5 text-left text-[12px] transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[640px] space-y-5">
            {turns.map((turn) =>
              turn.role === "user" ? (
                <div key={turn.id} className="flex justify-end gap-2.5">
                  <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2.5 text-[12.5px] leading-5 text-primary-foreground">
                    {turn.text}
                  </p>
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <User className="h-3 w-3" />
                  </span>
                </div>
              ) : (
                <div key={turn.id} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Bot className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="text-[12.5px] leading-5">{turn.text}</p>
                    {turn.draft ? (
                      <DraftCard draft={turn.draft} onApply={onApply} />
                    ) : null}
                  </div>
                </div>
              ),
            )}

            {thinking ? (
              <div className="flex gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-3 w-3" />
                </span>
                <p
                  role="status"
                  className="flex items-center gap-2 text-[12.5px] text-muted-foreground"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Drafting your campaign…
                </p>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="mx-auto flex max-w-[640px] items-end gap-2 rounded-xl border border-border bg-background p-2 focus-within:border-primary/50">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a new line, as in every chat.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              turns.length
                ? "Ask for a change — shorter, more urgent, different angle…"
                : "Describe the campaign you want to send"
            }
            aria-label="Describe your campaign"
            rows={1}
            className="max-h-32 min-h-[36px] resize-none border-0 bg-transparent px-1.5 py-1.5 text-[12.5px] shadow-none focus-visible:ring-0"
          />
          <Button
            type="button"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg"
            aria-label="Send"
            disabled={!prompt.trim() || thinking}
            onClick={submit}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-[640px] text-[10px] text-muted-foreground">
          Drafts are suggestions. Nothing sends until you take it through the
          builder and the send wizard.
        </p>
      </div>
    </div>
  );
}

/** One generated campaign, shown inline in the thread. */
function DraftCard({
  draft,
  onApply,
}: {
  draft: CampaignDraft;
  onApply: (draft: CampaignDraft, subject: string) => void;
}) {
  const [subject, setSubject] = useState(draft.subjects[0]?.text || "");

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-start gap-3 border-b border-border p-3">
        <CampaignThumbnail
          design={draft.design}
          className="h-[92px] w-[72px] shrink-0 rounded-md border border-border"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{draft.name}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[9px]">
              {campaignCategoryLabels[
                draft.category as keyof typeof campaignCategoryLabels
              ] || draft.category}
            </Badge>
            {draft.segment ? (
              <Badge variant="outline" className="text-[9px]">
                {draft.segment.listName}
              </Badge>
            ) : null}
            <Badge variant="outline" className="text-[9px]">
              {draft.sendTime.basis === "history" ? formatHourLabel(draft.sendTime.hour) : "No send-time data yet"}
            </Badge>
          </div>
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {draft.previewText}
          </p>
        </div>
      </div>

      <div className="space-y-1.5 p-3">
        <p className="text-[9.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
          Pick a subject line
        </p>
        {draft.subjects.map((option) => (
          <button
            key={option.text}
            type="button"
            onClick={() => setSubject(option.text)}
            className={cn(
              "flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors",
              subject === option.text
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/40",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium leading-tight">
                {option.text}
              </span>
              <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                {option.reasons.join(" · ")}
              </span>
            </span>
            <Badge
              variant="outline"
              className={cn("shrink-0 text-[9px]", qualityClass(option.quality))}
            >
              {option.quality}
            </Badge>
          </button>
        ))}
      </div>

      <div className="border-t border-border p-3">
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={!subject}
          onClick={() => onApply(draft, subject)}
        >
          Open in builder
        </Button>
      </div>
    </div>
  );
}

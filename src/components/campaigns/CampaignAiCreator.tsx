/**
 * AI Creator tab.
 *
 * A guided flow, not a single button. It drafts subject lines, a preheader, a
 * body in the workspace's brand voice, a target segment, and a send time — then
 * hands all of it to the Builder, Audience, and Scheduling tabs for review. It
 * never sends anything itself, and every suggestion states why it was made.
 */
import { useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Info,
  Wand2,
  Target,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ContactListRecord } from "@/lib/contacts";
import { cn } from "@/lib/utils";

import { CampaignThumbnail } from "./CampaignPreview";
import { formatHourLabel } from "./campaign-format";
import {
  draftCampaign,
  type BrandVoice,
  type CampaignDraft,
  type SubjectQuality,
} from "./campaign-ai";
import { campaignCategoryLabels } from "./campaign-templates";

const examplePrompts = [
  "Announce our summer sale, 20% off, ends Friday",
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

export function CampaignAiCreator({
  brandVoice,
  lists,
  mailingAddress,
  onApply,
  openHours,
}: {
  brandVoice: BrandVoice;
  lists: ContactListRecord[];
  mailingAddress: string;
  onApply: (draft: CampaignDraft, subject: string) => void;
  openHours: Array<{ hour: number; opens: number }>;
}) {
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [chosenSubject, setChosenSubject] = useState("");

  const generate = () => {
    const result = draftCampaign({
      prompt: prompt.trim(),
      lists,
      openHours,
      brandVoice,
      mailingAddress,
    });
    setDraft(result);
    setChosenSubject(result.subjects[0]?.text || "");
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-primary/20 bg-primary/[0.035] p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-[14px] font-semibold">AI campaign creator</h3>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted-foreground">
              Describe the campaign and this drafts subject lines, a preheader, a
              body in your brand voice, a target segment, and a send time. Every
              piece lands in the normal tabs as an editable draft — nothing is
              sent without you approving it.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="space-y-1.5">
          <Label htmlFor="campaign-ai-prompt">
            1 · What is this campaign about?
          </Label>
          <Textarea
            id="campaign-ai-prompt"
            className="min-h-[92px]"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Announce our summer sale, 20% off, ends Friday"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {examplePrompts.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPrompt(example)}
              className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[10px] text-muted-foreground">
            Brand voice: <span className="font-medium">{brandVoice}</span>. Change
            it in the Settings tab.
          </p>
          <Button
            type="button"
            disabled={prompt.trim().length < 8}
            onClick={generate}
          >
            <Wand2 className="h-4 w-4" />
            Draft this campaign
          </Button>
        </div>
      </section>

      {draft ? (
        <>
          <section className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div>
              <h3 className="text-[14px] font-semibold">
                2 · Subject line options
              </h3>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                Each label is a best-practice signal based on length, deadline
                framing, and personalization — not a predicted open rate. Nothing
                here can see your sender reputation or how this audience has
                behaved before.
              </p>
            </div>
            <div className="space-y-2">
              {draft.subjects.map((option) => (
                <button
                  key={option.text}
                  type="button"
                  onClick={() => setChosenSubject(option.text)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    chosenSubject === option.text
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    {chosenSubject === option.text ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full border border-border" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium">
                      {option.text}
                    </span>
                    <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                      {option.reasons.join(" · ")}
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[9px]",
                      qualityClass(option.quality),
                    )}
                  >
                    {option.quality}
                  </Badge>
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <p className="text-[10px] font-medium text-muted-foreground">
                Preheader
              </p>
              <p className="mt-1 text-[11px]">{draft.previewText}</p>
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,.7fr)]">
            <section className="space-y-3 rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-semibold">3 · Draft body</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Built on the {draft.templateName} layout.
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[9px]">
                  {campaignCategoryLabels[draft.category]}
                </Badge>
              </div>
              <CampaignThumbnail
                design={draft.design}
                className="h-[280px] w-full border border-border"
              />
            </section>

            <div className="space-y-4">
              <section className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <h3 className="text-[13px] font-semibold">
                    4 · Suggested audience
                  </h3>
                </div>
                {draft.segment ? (
                  <>
                    <p className="mt-3 flex items-center gap-1.5 text-[12px] font-medium">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      {draft.segment.listName}
                    </p>
                    <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                      {draft.segment.reason}
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                    No existing list reads as a fit for this kind of campaign, so
                    there is nothing to suggest. Pick one yourself in the Audience
                    tab, or create the segment under CRM → Contacts.
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <h3 className="text-[13px] font-semibold">
                    5 · Suggested send time
                  </h3>
                </div>
                {draft.sendTime.basis === "history" ? (
                  <>
                    <p className="mt-3 text-[16px] font-semibold">
                      {formatHourLabel(draft.sendTime.hour)}
                    </p>
                    <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                      Your best-performing hour across{" "}
                      {draft.sendTime.sampleSize.toLocaleString()} recorded opens
                      in this workspace, with{" "}
                      {draft.sendTime.opens.toLocaleString()} of them in this hour.
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                    Not enough send history to suggest a time yet — only{" "}
                    {draft.sendTime.sampleSize.toLocaleString()} recorded opens.
                    A generic "Tuesday at 10am" would not be based on anything, so
                    choose a time in Scheduling and this fills in as your data
                    grows.
                  </p>
                )}
              </section>
            </div>
          </div>

          <section className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              <h3 className="text-[13px] font-semibold">What was decided</h3>
            </div>
            <ul className="space-y-2">
              {draft.notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                  <span className="text-[11px] leading-5 text-muted-foreground">
                    {note}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={!chosenSubject.trim()}
              onClick={() => onApply(draft, chosenSubject)}
            >
              Open in the builder
              <ArrowRight className="h-4 w-4" />
            </Button>
            <p className="text-[10px] leading-4 text-muted-foreground">
              This creates a draft. Review it in the Builder, confirm the audience,
              and set the schedule yourself — the draft cannot send on its own.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

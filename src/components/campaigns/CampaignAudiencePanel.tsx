/**
 * Audience tab.
 *
 * The number on screen is the deliverable count, not the raw list size: the
 * breakdown walks from everyone in the list down to who will actually receive
 * the message.
 */
import { Ban, Loader2, Target, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CampaignAudiencePreview,
  ContactListRecord,
} from "@/lib/contacts";
import { cn } from "@/lib/utils";

const NO_EXCLUSION = "__none__";

export function CampaignAudiencePanel({
  excludeListId,
  lists,
  loading,
  onExcludeListChange,
  onListChange,
  preview,
  listId,
}: {
  excludeListId: string;
  lists: ContactListRecord[];
  loading: boolean;
  onExcludeListChange: (value: string) => void;
  onListChange: (value: string) => void;
  preview?: CampaignAudiencePreview;
  listId: string;
}) {
  const targetList = lists.find((list) => list.id === listId);

  const steps = preview
    ? [
        {
          label: `Everyone in ${preview.listName}`,
          value: preview.totalInList,
          tone: "text-foreground",
        },
        {
          label: preview.excludeListName
            ? `Also in ${preview.excludeListName}`
            : "Excluded by list",
          value: -preview.excluded,
          tone: "text-muted-foreground",
        },
        {
          label: "Unsubscribed",
          value: -preview.unsubscribed,
          tone: "text-muted-foreground",
        },
        {
          label: "Bounced or suppressed",
          value: -preview.suppressed,
          tone: "text-muted-foreground",
        },
        {
          label: "No usable email address",
          value: -preview.missingEmail,
          tone: "text-muted-foreground",
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.75fr)]">
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold">Targeting</h3>
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">
            The same list and segment picker used in Contacts and Documents bulk
            send. A dynamic segment is evaluated live, so this count reflects who
            matches right now.
          </p>

          <div className="space-y-1.5">
            <Label>Send to</Label>
            <Select value={listId} onValueChange={onListChange}>
              <SelectTrigger aria-label="Campaign audience">
                <SelectValue placeholder="Choose a list or segment" />
              </SelectTrigger>
              <SelectContent>
                {lists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name} ·{" "}
                    {list.listType === "dynamic" ? "segment" : "list"} ·{" "}
                    {list.memberCount.toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetList?.description ? (
              <p className="text-[10px] text-muted-foreground">
                {targetList.description}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Except anyone also in</Label>
            <Select
              value={excludeListId || NO_EXCLUSION}
              onValueChange={(value) =>
                onExcludeListChange(value === NO_EXCLUSION ? "" : value)
              }
            >
              <SelectTrigger aria-label="Campaign exclusion list">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_EXCLUSION}>No exclusion</SelectItem>
                {lists
                  .filter((list) => list.id !== listId)
                  .map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name} · {list.memberCount.toLocaleString()}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] leading-4 text-muted-foreground">
              Useful when one group needs a different version of the same
              message — send the general newsletter to everyone except the VIP
              list who get their own.
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold">Who receives this</h3>
          </div>

          {loading && !preview ? (
            <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Counting recipients…
            </div>
          ) : preview ? (
            <>
              <div className="mt-5 space-y-2.5">
                {steps.map((step) => (
                  <div
                    key={step.label}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span
                      className={cn("text-[11px] leading-4", step.tone)}
                    >
                      {step.label}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {step.value > 0
                        ? step.value.toLocaleString()
                        : step.value === 0
                          ? "0"
                          : `−${Math.abs(step.value).toLocaleString()}`}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-4">
                <span className="text-[12px] font-semibold">
                  Will actually receive
                </span>
                <span className="font-mono text-[22px] font-semibold tabular-nums">
                  {preview.deliverable.toLocaleString()}
                </span>
              </div>
              {loading ? (
                <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Updating…
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-6 text-[11px] text-muted-foreground">
              Choose a list to see the deliverable count.
            </p>
          )}
        </section>
      </div>

      {preview && preview.excluded > 0 ? (
        <section className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-4 py-3">
          <Ban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground">
            {preview.excluded.toLocaleString()} contact
            {preview.excluded === 1 ? "" : "s"} removed by the exclusion list.
          </p>
          <Badge variant="outline" className="ml-auto shrink-0 text-[9px]">
            {preview.excludeListName}
          </Badge>
        </section>
      ) : null}

      {!lists.length ? (
        <section className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-[12px] font-medium">No lists or segments yet</p>
          <p className="mx-auto mt-1 max-w-md text-[11px] leading-5 text-muted-foreground">
            Create a list or a dynamic segment under CRM → Contacts, then come
            back to target it here.
          </p>
        </section>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, Search, Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CampaignAudienceMode, ContactListRecord } from "@/lib/contacts";
import { cn } from "@/lib/utils";
import {
  campaignListRecipientCount,
  MAX_CUSTOM_AUDIENCE_RECIPIENTS,
} from "./campaign-audience-utils";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const splitEmails = (value: string) =>
  value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

export function CampaignAudiencePicker({
  mode,
  lists,
  selectedListIds,
  customRecipients,
  onModeChange,
  onToggleList,
  onCustomRecipientsChange,
  onValidateCustomRecipients,
}: {
  mode: CampaignAudienceMode;
  lists: ContactListRecord[];
  selectedListIds: string[];
  customRecipients: string[];
  onModeChange: (mode: CampaignAudienceMode) => void;
  onToggleList: (listId: string) => void;
  onCustomRecipientsChange: (recipients: string[]) => void;
  onValidateCustomRecipients?: (recipients: string[]) => Promise<string[]>;
}) {
  const [search, setSearch] = useState("");
  const [sortBySize, setSortBySize] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailError, setEmailError] = useState("");
  const [checkingEmail, setCheckingEmail] = useState(false);
  const recipientsRef = useRef(customRecipients);
  const validationQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    recipientsRef.current = customRecipients;
  }, [customRecipients]);

  const visibleLists = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = lists.filter(
      (list) => !query || list.name.toLowerCase().includes(query),
    );
    return sortBySize
      ? [...filtered].sort(
          (first, second) =>
            campaignListRecipientCount(second) -
            campaignListRecipientCount(first),
        )
      : filtered;
  }, [lists, search, sortBySize]);

  const addEmails = (value: string) => {
    const entries = splitEmails(value);
    if (!entries.length) return;
    const invalid = entries.find((email) => !emailPattern.test(email));
    if (invalid) {
      setEmailError(`“${invalid.slice(0, 80)}” is not a valid email address.`);
      return;
    }
    const job = validationQueueRef.current.then(async () => {
      const currentRecipients = recipientsRef.current;
      const newEntries = entries.filter(
        (email) => !currentRecipients.includes(email),
      );
      const next = Array.from(new Set([...currentRecipients, ...entries]));
      if (next.length > MAX_CUSTOM_AUDIENCE_RECIPIENTS) {
        setEmailError(
          `You can add up to ${MAX_CUSTOM_AUDIENCE_RECIPIENTS.toLocaleString()} email addresses.`,
        );
        return;
      }
      if (onValidateCustomRecipients && newEntries.length) {
        setCheckingEmail(true);
        try {
          const blocked = Array.from(
            new Set(
              (await onValidateCustomRecipients(newEntries)).map((email) =>
                email.toLowerCase(),
              ),
            ),
          );
          const blockedSet = new Set(blocked);
          const accepted = newEntries.filter((email) => !blockedSet.has(email));
          const updatedRecipients = Array.from(
            new Set([...recipientsRef.current, ...accepted]),
          );
          recipientsRef.current = updatedRecipients;
          if (accepted.length) onCustomRecipientsChange(updatedRecipients);
          if (blocked.length) {
            const shown = blocked.slice(0, 3).join(", ");
            const suffix = blocked.length > 3 ? " and others" : "";
            setEmailError(
              `${shown}${suffix} ${blocked.length === 1 ? "is" : "are"} unsubscribed or suppressed and cannot be added.`,
            );
          } else {
            setEmailError("");
          }
          setEmailDraft("");
          return;
        } catch {
          setEmailError(
            "We could not verify this address against the suppression list. Try again.",
          );
          return;
        } finally {
          setCheckingEmail(false);
        }
      }
      recipientsRef.current = next;
      setEmailError("");
      setEmailDraft("");
      onCustomRecipientsChange(next);
    });
    validationQueueRef.current = job.catch(() => undefined);
  };

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold">Choose recipients</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Use one or more CRM lists, or send directly to addresses you enter.
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {mode === "lists"
              ? `${selectedListIds.length} list${selectedListIds.length === 1 ? "" : "s"}`
              : `${customRecipients.length.toLocaleString()} email${customRecipients.length === 1 ? "" : "s"}`}
          </Badge>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2" role="group" aria-label="Recipient source">
          <button
            type="button"
            aria-pressed={mode === "lists"}
            onClick={() => onModeChange("lists")}
            className={cn(
              "flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
              mode === "lists"
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border hover:bg-muted/50",
            )}
          >
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">Use CRM lists</span>
              <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                Select multiple lists and deduplicate overlapping contacts.
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "custom"}
            onClick={() => onModeChange("custom")}
            className={cn(
              "flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
              mode === "custom"
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border hover:bg-muted/50",
            )}
          >
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">Enter emails manually</span>
              <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                Add as many addresses as needed, one at a time with Enter.
              </span>
            </span>
          </button>
        </div>
      </div>

      {mode === "lists" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <p className="text-[11.5px] text-muted-foreground">
              Select every list or segment this campaign should include.
            </p>
            <div className="flex items-center gap-2">
              <div className="relative w-[210px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find by name"
                  aria-label="Search lists"
                  className="h-9 pl-9 text-[12px]"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 text-[11.5px]"
                onClick={() => setSortBySize((current) => !current)}
                aria-pressed={sortBySize}
              >
                {sortBySize ? "Largest first" : "Sort"}
              </Button>
            </div>
          </div>
          {visibleLists.length ? (
            <ul className="divide-y divide-border">
              {visibleLists.map((list) => {
                const selected = selectedListIds.includes(list.id);
                return (
                  <li key={list.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50",
                        selected && "bg-primary/4",
                      )}
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => onToggleList(list.id)}
                        aria-label={`Select ${list.name}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">
                          {list.name}
                        </span>
                        {list.description ? (
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {list.description}
                          </span>
                        ) : null}
                      </span>
                      <Badge
                        variant="outline"
                        className="shrink-0 border-border/70 text-[9px] text-muted-foreground"
                      >
                        {list.listType === "dynamic" ? "Segment" : "List"}
                      </Badge>
                      <span className="w-[70px] shrink-0 text-right text-[12.5px] font-medium tabular-nums">
                        {campaignListRecipientCount(list).toLocaleString()}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-12 text-center text-[11.5px] text-muted-foreground">
              {lists.length ? "No list matches that search." : "No lists yet. Create one under CRM → Contacts."}
            </p>
          )}
        </>
      ) : (
        <div className="space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="custom-recipient-email">Recipient email addresses</Label>
            <Input
              id="custom-recipient-email"
              value={emailDraft}
              disabled={checkingEmail}
              onChange={(event) => {
                setEmailDraft(event.target.value);
                if (emailError) setEmailError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "," || event.key === ";") {
                  event.preventDefault();
                  void addEmails(emailDraft);
                }
              }}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text");
                if (splitEmails(pasted).length > 1) {
                  event.preventDefault();
                  void addEmails(pasted);
                }
              }}
              placeholder="name@example.com — press Enter"
              inputMode="email"
              aria-describedby="custom-recipient-help"
              aria-busy={checkingEmail}
            />
            <p id="custom-recipient-help" className="text-[10.5px] leading-4 text-muted-foreground">
              Press Enter after each address. You can also paste comma-, semicolon-, or newline-separated emails.
            </p>
            {emailError ? (
              <p role="alert" className="text-[11px] text-destructive">
                {emailError}
              </p>
            ) : null}
          </div>

      {customRecipients.length ? (
            <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
              {customRecipients.map((email) => (
                <Badge key={email} variant="secondary" className="gap-1 py-1 text-[10.5px]">
                  <span className="max-w-[230px] truncate">{email}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    className="rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      const next = customRecipients.filter((entry) => entry !== email);
                      recipientsRef.current = next;
                      onCustomRecipientsChange(next);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[11px] text-muted-foreground">
              No custom addresses added yet.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

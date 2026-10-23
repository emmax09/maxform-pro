/**
 * Settings tab.
 *
 * Campaign-specific sender defaults and the compliance footer address that
 * gates sending. Suppression state is not duplicated here:
 * it is read from the one workspace suppression list that Contacts and Email
 * also use, so an opt-out exists in exactly one place.
 */
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ContactCampaignSettings } from "@/lib/contacts";
import type { EmailIdentity } from "@/lib/email";

const DEFAULT_IDENTITY = "__default__";

const brandVoices: Array<{
  value: ContactCampaignSettings["brandVoice"];
  label: string;
  detail: string;
}> = [
  { value: "friendly", label: "Friendly", detail: "Warm, first-person, direct." },
  { value: "direct", label: "Direct", detail: "Short sentences, no preamble." },
  { value: "playful", label: "Playful", detail: "Light, conversational." },
  { value: "formal", label: "Formal", detail: "Measured and precise." },
];

export function CampaignSettingsPanel({
  identities,
  onChange,
  onSave,
  settings,
  suppressionCount,
  working,
}: {
  identities: EmailIdentity[];
  onChange: (patch: Partial<ContactCampaignSettings>) => void;
  onSave: () => void;
  settings: ContactCampaignSettings;
  suppressionCount: number;
  working: boolean;
}) {
  const addressReady = settings.mailingAddress.trim().length > 0;

  return (
    <div className="space-y-5">
      <section
        className={
          addressReady
            ? "flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4"
            : "flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/[0.05] p-4"
        }
      >
        {addressReady ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        )}
        <div>
          <p className="text-[12px] font-semibold">
            {addressReady
              ? "Campaigns can send"
              : "Campaigns are blocked from sending"}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {addressReady
              ? "Your workspace business address is on file and is written into the compliance footer of every campaign."
              : "Marketing email is required to carry a physical mailing address. Add it in General settings before sending."}
          </p>
        </div>
      </section>

      <div>
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold">Sender identity</h3>
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">
            Campaigns use the same provider-independent sender identity as
            forms, receipts, appointments, and automations.
          </p>
          <div className="space-y-1.5">
            <Label>Default campaign sender</Label>
            <Select
              value={settings.identityId || DEFAULT_IDENTITY}
              onValueChange={(value) =>
                onChange({
                  identityId: value === DEFAULT_IDENTITY ? null : value,
                })
              }
            >
              <SelectTrigger aria-label="Default campaign sender">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_IDENTITY}>
                  Use the workspace default
                </SelectItem>
                {identities.map((identity) => (
                  <SelectItem key={identity.id} value={identity.id}>
                    {identity.senderName} · {identity.senderEmail}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!identities.length ? (
              <p className="text-[10px] leading-4 text-muted-foreground">
                No sender identity yet. Add one under Email settings →
                Identity.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-[14px] font-semibold">Compliance footer</h3>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-mailing-address">
              Physical mailing address
            </Label>
            <Textarea
              id="campaign-mailing-address"
              className="min-h-[92px]"
              readOnly
              value={settings.mailingAddress}
              placeholder={"Add a business address in General settings"}
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              This is managed from your workspace business address so every
              module uses the same formatted address.
            </p>
            <a
              href="/dashboard?tab=settings&section=workspace"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
            >
              Update address in General settings
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-footer-text">Footer line</Label>
            <Textarea
              id="campaign-footer-text"
              className="min-h-[92px]"
              value={settings.footerText}
              onChange={(event) => onChange({ footerText: event.target.value })}
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              Appears under every campaign. {"{{workspace.name}}"} is replaced at
              send time.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h3 className="text-[14px] font-semibold">Brand voice</h3>
        <p className="text-[11px] leading-5 text-muted-foreground">
          The AI Creator writes body copy in this voice.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {brandVoices.map((voice) => (
            <button
              key={voice.value}
              type="button"
              onClick={() => onChange({ brandVoice: voice.value })}
              className={
                settings.brandVoice === voice.value
                  ? "rounded-lg border border-primary bg-primary/5 p-3 text-left"
                  : "rounded-lg border border-border p-3 text-left hover:border-primary/40"
              }
            >
              <span className="block text-[12px] font-medium">
                {voice.label}
              </span>
              <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                {voice.detail}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold">Suppression list</h3>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">
              Bounced, complained, and unsubscribed contacts. This is the same
              list Contacts and Email read, not a campaign-only copy — an opt-out
              from any campaign removes that contact from every future send.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {suppressionCount.toLocaleString()} suppressed
          </Badge>
        </div>
        <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
          Manage individual entries under Email settings → Safety, or on the
          contact's own record.
        </p>
      </section>

      <div className="flex justify-end">
        <Button type="button" disabled={working} onClick={onSave}>
          {working ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Save campaign settings
        </Button>
      </div>
    </div>
  );
}

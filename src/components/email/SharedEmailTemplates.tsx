import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { TemplateDialog } from "@/components/email/EmailModule";
import { templateArtwork } from "@/components/email/email-artwork";
import { PaginatedCardGrid } from "@/components/shared/CardGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EMAIL_TEMPLATES_UPDATED_EVENT,
  getEmailWorkspace,
  isWorkspaceEmailTemplate,
  saveEmailTemplate,
  type EmailTemplate,
  type EmailWorkspace,
} from "@/lib/email";
import { variablePlainText } from "@/lib/template-variables";

export type SharedEmailTemplateModule =
  | "events"
  | "forms"
  | "appointments"
  | "payments";

const moduleInfo: Record<SharedEmailTemplateModule, {
  label: string;
  resource: string;
  description: string;
}> = {
  events: {
    label: "Events",
    resource: "event",
    description: "Manage the shared event email designs used by every event in this workspace.",
  },
  forms: {
    label: "Forms",
    resource: "form",
    description: "Manage the shared form email designs used by every form in this workspace.",
  },
  appointments: {
    label: "Appointments",
    resource: "appointment",
    description: "Manage the shared appointment email designs used by every appointment in this workspace.",
  },
  payments: {
    label: "Payments",
    resource: "payment",
    description: "Manage the shared payment email designs used by every payment flow in this workspace.",
  },
};

export function SharedEmailTemplates({ module }: { module: SharedEmailTemplateModule }) {
  const info = moduleInfo[module];
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [identities, setIdentities] = useState<EmailWorkspace["identities"]>([]);
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const workspace = await getEmailWorkspace();
      setTemplates(workspace.templates.filter((template) => template.module === module && isWorkspaceEmailTemplate(template)));
      setIdentities(workspace.identities);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : `${info.label} email templates could not be loaded.`);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [info.label, module]);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(EMAIL_TEMPLATES_UPDATED_EVENT, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(EMAIL_TEMPLATES_UPDATED_EVENT, refresh);
    };
  }, [load]);

  const save = async (input: Partial<EmailTemplate>) => {
    if (!editing) return;
    const current = editing;
    setWorkingKey(current.key);
    try {
      const response = await saveEmailTemplate({
        ...input,
        id: current.id,
        key: current.key,
        module,
      });
      const saved = response.template;
      setTemplates((items) => items.map((item) => item.id === current.id ? saved : item));
      setEditing(null);
      toast.success(`${current.name} updated for every ${info.resource}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `The ${info.label.toLowerCase()} email template could not be saved.`);
    } finally {
      setWorkingKey(null);
    }
  };

  if (loading) return <div className="flex min-h-[300px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  return <>
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary"><FileText className="h-4 w-4" /> {info.label}</div>
          <h2 className="mt-2 text-[22px] font-semibold">Email templates</h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">{info.description} Edit the design once here or in Email settings; the same template is used everywhere this module sends mail.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh</Button>
      </div>
      {templates.length ? <PaginatedCardGrid
        items={templates}
        pageSize={12}
        itemLabel={`${info.label.toLowerCase()} email templates`}
        getKey={(template) => template.id}
        renderItem={(template) => <button
          key={template.id}
          type="button"
          onClick={() => setEditing(template)}
          className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
        >
          <div className="relative overflow-hidden border-b border-border">
            <img src={templateArtwork(template)} alt={`${variablePlainText(template.name)} email preview`} loading="lazy" className="aspect-[1.62/1] w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
            <span className="absolute left-3 top-3 rounded-md bg-white/92 px-2 py-1 text-[9px] font-semibold text-slate-700 shadow-xs backdrop-blur-xs">{info.label}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{variablePlainText(template.name)}</p>
              <Badge variant="outline" className={`shrink-0 text-[9px] ${template.isCustom ? "border-primary/25 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{template.isCustom ? "Custom" : "Ready"}</Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{variablePlainText(template.subject)}</p>
            <div className="mt-auto flex items-center justify-between pt-3 text-[10px] text-muted-foreground">
              <span>Used by every {info.resource}</span>
              <span className="font-medium text-primary">Edit design →</span>
            </div>
          </div>
        </button>}
      /> : <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No {info.label.toLowerCase()} email templates are configured yet.</p>}
    </section>
    <TemplateDialog
      open={Boolean(editing)}
      onOpenChange={(open) => { if (!open) setEditing(null); }}
      template={editing}
      identities={identities}
      working={workingKey === editing?.key}
      onSendTest={() => toast.info("Use the Email module to send a test message for this shared template.")}
      onSave={(input) => { void save(input); }}
    />
  </>;
}

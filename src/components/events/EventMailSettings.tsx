import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  listEventMailSettings,
  toggleEventMailSetting,
  type EventMailSetting,
} from "@/lib/events";
import type { EventRecord } from "@/components/events/event-types";

export function EventMailSettings({ event }: { event: EventRecord }) {
  const [settings, setSettings] = useState<EventMailSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setSettings(await listEventMailSettings(event.id));
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Event email settings could not be loaded.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [event.id]);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const toggle = async (setting: EventMailSetting, enabled: boolean) => {
    setWorkingKey(setting.key);
    try {
      await toggleEventMailSetting(event.id, setting.key, enabled);
      setSettings((current) => current.map((item) => item.key === setting.key ? { ...item, enabled } : item));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The event email setting could not be changed.");
    } finally {
      setWorkingKey(null);
    }
  };

  if (loading) return <div className="flex min-h-[300px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  return <section className="space-y-6">
    <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-end">
      <div>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary"><Mail className="h-4 w-4" /> Event communications</div>
        <h2 className="mt-2 text-[22px] font-semibold">Mail settings</h2>
        <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">Turn each shared event email on or off for this event. Edit the designs once in the Events email templates tab and every event will use the updated version.</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh</Button>
    </div>
    {settings.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {settings.map((setting) => <Card key={setting.key} className={`flex h-full flex-col ${setting.applicable ? "" : "border-dashed bg-muted/10"}`}>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="flex min-w-0 items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Mail className="h-4 w-4" /></span><div className="min-w-0"><CardTitle className="text-[14px]">{setting.name}</CardTitle><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{setting.description}</p></div></div>
          <Switch checked={setting.enabled} onCheckedChange={(value) => void toggle(setting, value)} disabled={workingKey === setting.key} aria-label={`Enable ${setting.name}`} />
        </CardHeader>
        <CardContent className="mt-auto border-t border-border pt-4"><div className="flex items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={setting.enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "text-muted-foreground"}>{setting.enabled ? <><Check className="mr-1 h-3 w-3" />Enabled</> : "Off"}</Badge>{!setting.applicable && <Badge variant="outline" className="text-muted-foreground">Not used yet</Badge>}</div><span className="text-[10px] text-muted-foreground">Shared design</span></div></CardContent>
      </Card>)}
    </div> : <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No event email templates are configured yet.</p>}
  </section>;
}

import { ExternalLink, Link2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ModuleIntegrationNotice({ moduleName }: { moduleName: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Link2 className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold">{moduleName} connections</h3>
            <p className="mt-1 max-w-xl text-[12px] leading-5 text-muted-foreground">
              Choose and manage provider connections in the central Integrations hub. Connected providers appear automatically wherever this module supports them.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" asChild>
          <a href="/dashboard?tab=integrations&section=connections">
            View connections
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </div>
      <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        Credentials remain encrypted on the server and are never exposed to this module.
      </div>
    </div>
  );
}

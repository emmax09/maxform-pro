/**
 * Whether the app a step depends on is actually usable.
 *
 * A connected-app action is only as real as its connection, and the failure is
 * quiet: the node saves, the workflow publishes, and the step fails at run time
 * against a provider nobody re-authorised. This states the connection's
 * standing where the step is configured, and says what to do about it.
 *
 * The workspace's existing connection records are the only source — nothing
 * here creates or re-authorises a connection, it reports what Integrations
 * already knows.
 */
import { CircleAlert, CircleCheck, ExternalLink, Plug } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { WorkflowConnection } from "@/lib/workflows";
import {
  REQUIRED_SCOPES,
  type ConnectionStanding,
} from "@/components/workflows/workflow-connection-state";
import { cn } from "@/lib/utils";


const INTEGRATIONS_HREF = "/dashboard?tab=integrations&section=connections";

export function WorkflowConnectionState({
  standing,
  connection,
  operation,
}: {
  standing: ConnectionStanding;
  connection: WorkflowConnection | null;
  operation: string;
}) {
  if (standing === "connected") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
        <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Connected as {connection?.label || connection?.providerName}
      </p>
    );
  }

  const copy =
    standing === "connection_required"
      ? {
          title: "Connection required",
          detail:
            "This step runs through a connected app, and this workspace has not connected one yet.",
          action: "Connect an app",
        }
      : standing === "not_chosen"
        ? {
            title: "Choose a connection",
            detail: "Pick which connected account this step should run through.",
            action: "",
          }
        : {
            title: "Reconnect required",
            detail: REQUIRED_SCOPES[operation]
              ? `${connection?.providerName || "This app"} is connected but has not granted the permission this step needs.`
              : `${connection?.providerName || "This app"} needs to be reconnected before it can run.`,
            action: "Reconnect in Integrations",
          };

  return (
    <div
      role="status"
      className={cn(
        "space-y-1.5 rounded-md border p-2.5",
        standing === "not_chosen"
          ? "border-border bg-muted/40"
          : "border-amber-500/30 bg-amber-500/8",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 text-[11.5px] font-medium",
          standing === "not_chosen"
            ? "text-foreground"
            : "text-amber-700 dark:text-amber-300",
        )}
      >
        {standing === "not_chosen" ? (
          <Plug className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        {copy.title}
      </p>
      <p className="text-[11px] leading-4 text-muted-foreground">{copy.detail}</p>
      {copy.action && (
        <Button asChild type="button" size="sm" variant="outline" className="h-7">
          <a href={INTEGRATIONS_HREF}>
            <ExternalLink className="h-3 w-3" />
            {copy.action}
          </a>
        </Button>
      )}
    </div>
  );
}

export default WorkflowConnectionState;

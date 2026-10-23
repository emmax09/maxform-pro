/**
 * Whether the app a workflow step depends on is actually usable.
 *
 * Kept apart from the component that renders it so the rule can be tested on
 * its own — this is the decision that stops a step being configured against a
 * connection that would fail at run time, and it is worth pinning directly.
 */
import type { WorkflowConnection } from "@/lib/workflows";

export type ConnectionStanding =
  | "connected"
  | "reconnect_required"
  | "not_chosen"
  | "connection_required";

/** Scopes an operation cannot run without, keyed by the operation id. */
export const REQUIRED_SCOPES: Record<string, string> = {
  "gmail.send": "https://www.googleapis.com/auth/gmail.send",
};

/**
 * Resolves a step's connection standing.
 *
 * `partially_connected` and a missing operation scope are the same problem
 * wearing different hats — the account is linked but not authorised for what
 * this step does — so both resolve to "reconnect required" rather than being
 * reported as connected.
 */
export const connectionStanding = (
  connections: WorkflowConnection[],
  connection: WorkflowConnection | null,
  operation: string,
): ConnectionStanding => {
  if (connections.length === 0) return "connection_required";
  if (!connection) return "not_chosen";
  if (connection.status !== "connected") return "reconnect_required";
  const scope = REQUIRED_SCOPES[operation];
  if (scope && !connection.grantedScopes.includes(scope)) {
    return "reconnect_required";
  }
  return "connected";
};

/** True while the step cannot be meaningfully configured or run. */
export const connectionBlocks = (standing: ConnectionStanding) =>
  standing !== "connected";

import { describe, expect, it } from "vitest";

import {
  connectionBlocks,
  connectionStanding,
} from "@/components/workflows/workflow-connection-state";
import type { WorkflowConnection } from "@/lib/workflows";

const connection = (over: Partial<WorkflowConnection> = {}): WorkflowConnection => ({
  id: "11111111-1111-4111-8111-111111111111",
  provider: "google_workspace",
  providerName: "Google Workspace",
  label: "team@example.com",
  status: "connected",
  capabilities: ["email.send"],
  grantedScopes: ["https://www.googleapis.com/auth/gmail.send"],
  ...over,
});

describe("connection standing", () => {
  it("requires a connection when the workspace has none", () => {
    expect(connectionStanding([], null, "gmail.send")).toBe("connection_required");
  });

  it("asks for a choice when connections exist but none is picked", () => {
    expect(connectionStanding([connection()], null, "gmail.send")).toBe("not_chosen");
  });

  it("accepts a connected account that granted the scope", () => {
    const chosen = connection();
    expect(connectionStanding([chosen], chosen, "gmail.send")).toBe("connected");
  });

  it("treats a partially connected account as needing reconnection", () => {
    const partial = connection({ status: "partially_connected" });
    expect(connectionStanding([partial], partial, "gmail.send")).toBe(
      "reconnect_required",
    );
  });

  it("treats a missing operation scope as needing reconnection", () => {
    // Linked but not authorised for what this step does. Reporting it as
    // connected is how a step publishes and then fails at run time.
    const scopeless = connection({ grantedScopes: [] });
    expect(connectionStanding([scopeless], scopeless, "gmail.send")).toBe(
      "reconnect_required",
    );
  });

  it("does not demand a scope an operation never needed", () => {
    const scopeless = connection({ grantedScopes: [] });
    expect(connectionStanding([scopeless], scopeless, "append_row")).toBe(
      "connected",
    );
  });

  it("blocks configuration in every state except connected", () => {
    expect(connectionBlocks("connected")).toBe(false);
    expect(connectionBlocks("not_chosen")).toBe(true);
    expect(connectionBlocks("reconnect_required")).toBe(true);
    expect(connectionBlocks("connection_required")).toBe(true);
  });
});

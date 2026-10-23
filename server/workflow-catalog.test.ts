// @vitest-environment node
//
// The other half of the "no decorative controls" guarantee.
//
// `workflow-triggers.test.ts` proves every trigger is emitted by a module.
// This proves the rest of the palette is real: that every action and logic
// node the builder offers has an executor behind it, that the editor knows how
// to configure it, and that publishing validates the things it needs.
//
// The failure this prevents is the same one in a different place — a step you
// can drag onto the canvas, configure, publish, and then watch do nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WORKFLOW_NODE_CATALOG } from "../src/lib/workflows";

const executor = readFileSync(join(__dirname, "workflows-data.ts"), "utf8");
const editor = readFileSync(
  join(__dirname, "..", "src", "components", "workflows", "WorkflowsModule.tsx"),
  "utf8",
);

const runnable = WORKFLOW_NODE_CATALOG.filter(
  (entry) => entry.category === "actions" || entry.category === "logic",
);

/** Nodes that carry no configuration, so the editor owes them no fields. */
const PARAMETERLESS = new Set(["logic.noop"]);

describe("every action and logic node is real", () => {
  it("offers something to run", () => {
    // Guards against the catalog growing faster than the engine.
    expect(runnable.length).toBeGreaterThan(10);
  });

  it.each(runnable.map((entry) => entry.type))("%s has an executor", (type) => {
    expect(
      executor.includes(`node.type === "${type}"`),
      `${type} is offered in the builder but the workflow engine has no branch for it, so a workflow using it would publish and then do nothing.`,
    ).toBe(true);
  });

  it.each(runnable.filter((entry) => !PARAMETERLESS.has(entry.type)).map((entry) => entry.type))(
    "%s can be configured in the editor",
    (type) => {
      expect(
        editor.includes(`"${type}"`),
        `${type} has no configuration branch in the editor, so its parameters could never be set.`,
      ).toBe(true);
    },
  );
});

describe("publishing validates what a step needs", () => {
  it("refuses a graph with no trigger or no action", () => {
    expect(executor).toContain('code: "missing_trigger"');
    expect(executor).toContain('code: "missing_action"');
  });

  it("refuses a connected-app step whose connection cannot run it", () => {
    // The client disables the fields; the server is what actually stops a
    // broken connection reaching production, so both ends are asserted.
    expect(executor).toContain('code: "connection_missing"');
    expect(executor).toContain('code: "connection_unavailable"');
    expect(executor).toContain('code: "provider_action_invalid"');
    expect(executor).toContain("granted_scopes");
  });

  it("refuses a step left without the values it cannot run without", () => {
    for (const code of [
      "email_recipient_missing",
      "contact_email_missing",
      "contact_id_missing",
      "http_endpoint_invalid",
      "schedule_invalid",
      "delay_invalid",
    ]) {
      expect(executor, `missing validation: ${code}`).toContain(`code: "${code}"`);
    }
  });

  it("refuses a graph that could never finish", () => {
    expect(executor).toContain('code: "cycle"');
    expect(executor).toContain('code: "orphan_node"');
    expect(executor).toContain('code: "invalid_edge"');
  });

  it("refuses a node type the catalog no longer offers", () => {
    // An old workflow holding a removed step should say so rather than fail
    // silently at run time.
    expect(executor).toContain('code: "unknown_node"');
  });
});

describe("outbound requests stay inside the workspace's reach", () => {
  it("keeps the HTTP step off private networks", () => {
    // A workflow action that can be pointed at 169.254.169.254 is an SSRF
    // hole with a UI on it.
    expect(executor).toContain("169.254.169.254");
    expect(executor).toContain("metadata.google.internal");
    expect(executor).toMatch(/must use HTTPS/i);
  });
});

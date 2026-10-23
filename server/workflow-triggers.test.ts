// @vitest-environment node
//
// Guards the promise the builder's trigger palette makes.
//
// Every entry in the catalog is offered to a user as something they can build
// an automation on. A trigger with no emitter anywhere in the backend is a
// dead control: the workflow saves, publishes, reports itself healthy, and
// never runs. Three of them shipped that way (`email_sent`,
// `product_stock_low`, `subscriber_joined`), which is not something review
// catches reliably by eye across ten modules.
//
// What this proves: the event name a trigger listens for is produced somewhere
// in the server. What it cannot prove: that the emit is on the right code path
// or carries the right payload — that is what the per-trigger tests are for.
// It is a floor, not a ceiling, and it is the floor that was missing.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WORKFLOW_NODE_CATALOG, WORKFLOW_TRIGGER_TYPES } from "../src/lib/workflows";

/**
 * Triggers the engine raises itself rather than receiving from a module: the
 * editor's Run button, the webhook endpoint, and the scheduler.
 */
const ENGINE_TRIGGERS = new Set([
  "trigger.manual",
  "trigger.webhook",
  "trigger.schedule",
]);

const backendSources = () => {
  const serverDirectory = join(__dirname);
  const files = readdirSync(serverDirectory)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(serverDirectory, name));
  // Forms dispatch from the shared library rather than the server directory.
  files.push(join(__dirname, "..", "src", "lib", "forms.ts"));
  return files
    .map((file) => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
};

const sources = backendSources();

describe("every catalog trigger is connected to the system", () => {
  const moduleTriggers = WORKFLOW_TRIGGER_TYPES.filter(
    (trigger) => !ENGINE_TRIGGERS.has(trigger),
  );

  it.each(moduleTriggers)("%s is emitted by a module", (trigger) => {
    const eventType = trigger.replace(/^trigger\./, "");
    expect(
      sources.includes(`"${eventType}"`),
      `${trigger} is offered in the workflow builder but no backend module ever emits "${eventType}", so a workflow built on it can never run.`,
    ).toBe(true);
  });

  it("offers every trigger it can emit", () => {
    // The other direction: an event a module raises that the catalog never
    // lists is an automation nobody can subscribe to. `event_updated` and
    // `order_refunded` were both being emitted into the void.
    for (const emitted of ["event_updated", "order_refunded"]) {
      expect(WORKFLOW_TRIGGER_TYPES).toContain(`trigger.${emitted}`);
    }
  });

  it("describes every trigger it lists", () => {
    // A type with no catalog entry renders as a bare slug in the palette.
    for (const trigger of WORKFLOW_TRIGGER_TYPES) {
      const entry = WORKFLOW_NODE_CATALOG.find((item) => item.type === trigger);
      expect(entry, `${trigger} has no catalog entry`).toBeTruthy();
      expect(entry?.category).toBe("triggers");
      expect(entry?.label.length).toBeGreaterThan(0);
      expect(entry?.description.length).toBeGreaterThan(0);
    }
  });

  it("lists every trigger the catalog categorises as one", () => {
    // Catches the reverse drift: a catalog entry in the triggers category that
    // was never added to the type list is unreachable by the trigger picker.
    for (const entry of WORKFLOW_NODE_CATALOG) {
      if (entry.category !== "triggers") continue;
      expect(
        WORKFLOW_TRIGGER_TYPES as readonly string[],
        `${entry.type} is a trigger in the catalog but missing from WORKFLOW_TRIGGER_TYPES`,
      ).toContain(entry.type);
    }
  });
});

describe("the newly connected triggers", () => {
  it("emits email_sent onto the workflow bus, not only into analytics", () => {
    const dispatch = readFileSync(join(__dirname, "campaign-dispatch.ts"), "utf8");
    // recordCampaignEvent alone is analytics; the workflow bus is separate.
    expect(dispatch).toContain("dispatchWorkspaceWorkflowEvent");
    expect(dispatch).toMatch(/eventType === "email_sent"/);
  });

  it("emits subscriber_joined only for genuinely new members", () => {
    const contacts = readFileSync(join(__dirname, "contacts-data.ts"), "utf8");
    expect(contacts).toContain('"subscriber_joined"');
    // The insert must stay ON CONFLICT DO NOTHING with RETURNING, or a
    // re-import would re-announce every existing subscriber.
    expect(contacts).toMatch(
      /ON CONFLICT \(list_id, contact_id\) DO NOTHING\s*\n\s*RETURNING contact_id/,
    );
  });

  it("emits product_stock_low from the alert crossing", () => {
    const workflows = readFileSync(join(__dirname, "workflows-data.ts"), "utf8");
    expect(workflows).toContain('"product_stock_low"');
    // Claim-and-stamp in one statement, or two cron ticks double-announce.
    expect(workflows).toContain("FOR UPDATE SKIP LOCKED");
    expect(workflows).toContain("workflow_notified_at = NOW()");
  });

  it("runs the stock sweep on the workflow cron", () => {
    const workflows = readFileSync(join(__dirname, "workflows-data.ts"), "utf8");
    expect(workflows).toMatch(
      /processStockLowWorkflowEvents\(200\)[\s\S]{0,400}processPendingWorkflowEvents\(200\)/,
    );
  });
});

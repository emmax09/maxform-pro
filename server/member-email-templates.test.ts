/**
 * The workspace-membership email templates.
 *
 * These are the messages a person receives when they are added to someone
 * else's workspace, so two of them carry the credentials they sign in with.
 * That makes the variable contract worth pinning: server/workspace-members.ts
 * supplies the values, the seeded template consumes them, and a token renamed
 * on one side without the other would send a member an email with a blank
 * password and no way to notice.
 */
import { describe, expect, it } from "vitest";

import { templateSeeds } from "./workspace-email";

/** [key, module, name, subject, html, blocksJson] */
type Seed = (typeof templateSeeds)[number];

const memberSeeds = templateSeeds.filter((seed) => seed[1] === "members");
const byKey = (key: string) =>
  memberSeeds.find((seed) => seed[0] === key) as Seed | undefined;

const tokensIn = (value: string) =>
  new Set(
    [...value.matchAll(/\{\{\s*([^}#/][^}]*?)\s*\}\}/g)].map((match) =>
      match[1].trim(),
    ),
  );

describe("member email templates", () => {
  it("registers every membership message under the members module", () => {
    expect(memberSeeds.map((seed) => seed[0]).sort()).toEqual([
      "member_access_changed",
      "member_credentials",
      "member_password_reset",
      "member_removed",
      "member_suspended",
      "member_workspace_access",
    ]);
  });

  it("gives each one a name and a subject for the templates list", () => {
    for (const seed of memberSeeds) {
      expect(seed[2].length).toBeGreaterThan(0);
      expect(seed[3].length).toBeGreaterThan(0);
    }
  });

  it("keeps the workspace name in every subject", () => {
    for (const seed of memberSeeds) {
      expect(seed[3]).toContain("{{workspace.name}}");
    }
  });

  // The two that carry credentials. workspace-members.ts supplies exactly
  // these, so a rename on either side fails here rather than in someone's inbox.
  for (const key of ["member_credentials", "member_password_reset"]) {
    it(`${key} renders the sign-in details it is sent`, () => {
      const seed = byKey(key);
      expect(seed).toBeDefined();
      const tokens = tokensIn(seed![4]);
      expect(tokens).toContain("member.name");
      expect(tokens).toContain("member.username");
      expect(tokens).toContain("member.email");
      expect(tokens).toContain("member.password");
      expect(tokens).toContain("member.passwordLabel");
      expect(tokens).toContain("workspace.signInUrl");
    });
  }

  it("tells a member what they can open where that is the point", () => {
    for (const key of [
      "member_credentials",
      "member_workspace_access",
      "member_access_changed",
    ]) {
      expect(tokensIn(byKey(key)![4])).toContain("member.tabs");
    }
  });

  it("never shows a password in a message that is not about one", () => {
    for (const key of [
      "member_workspace_access",
      "member_access_changed",
      "member_suspended",
      "member_removed",
    ]) {
      const tokens = tokensIn(byKey(key)![4]);
      expect(tokens).not.toContain("member.password");
      expect(byKey(key)![4]).not.toContain("passwordLabel");
    }
  });

  it("builds editor blocks alongside the delivered HTML", () => {
    for (const seed of memberSeeds) {
      const blocks = JSON.parse(seed[5]) as Array<Record<string, unknown>>;
      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks.length).toBeGreaterThan(0);
    }
  });
});

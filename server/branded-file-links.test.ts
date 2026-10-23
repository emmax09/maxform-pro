import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  brandedFileTokenPattern,
  createBrandedFileLink,
  createBrandedFileToken,
  ensureWorkspaceShortId,
  readBrandedFileToken,
  resetWorkspaceShortIdCacheForTests,
  workspaceShortIdPattern,
  type WorkspaceQuery,
} from "./branded-file-links";

const originalEnvironment = { ...process.env };
const objectId = "3f4d1b2a-8c17-4a1e-9f2b-77c0d1a5e6b4";

describe("branded file links", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "a".repeat(48);
    process.env.PUBLIC_APP_URL = "https://app.maxform.test";
    delete process.env.BRANDED_FILE_URL_TTL_SECONDS;
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("round-trips the stored object id and disposition", () => {
    const signed = createBrandedFileToken({
      storageObjectId: objectId,
      disposition: "attachment",
    });

    expect(signed?.token).toMatch(brandedFileTokenPattern);
    const link = readBrandedFileToken(signed!.token);
    expect(link?.storageObjectId).toBe(objectId);
    expect(link?.disposition).toBe("attachment");
  });

  it("defaults to an inline disposition", () => {
    const signed = createBrandedFileToken({ storageObjectId: objectId });
    expect(readBrandedFileToken(signed!.token)?.disposition).toBe("inline");
  });

  it("produces a URL far shorter than a presigned provider URL", () => {
    const link = createBrandedFileLink({
      origin: "https://app.maxform.test",
      workspaceShortId: "aB3kM",
      storageObjectId: objectId,
    });

    expect(link?.url).toMatch(
      /^https:\/\/app\.maxform\.test\/aB3kM\/file\/[A-Za-z0-9_-]{44}$/,
    );
    expect(link!.url.length).toBeLessThan(120);
  });

  it("rejects a tampered token", () => {
    const signed = createBrandedFileToken({ storageObjectId: objectId });
    const flipped = `${signed!.token.slice(0, 43)}${
      signed!.token.endsWith("A") ? "B" : "A"
    }`;

    expect(readBrandedFileToken(flipped)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const signed = createBrandedFileToken({ storageObjectId: objectId });
    process.env.JWT_SECRET = "b".repeat(48);

    expect(readBrandedFileToken(signed!.token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const signed = createBrandedFileToken({
      storageObjectId: objectId,
      expiresInSeconds: 60,
    });
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      expect(readBrandedFileToken(signed!.token)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("refuses to build a link without an origin or workspace id", () => {
    expect(
      createBrandedFileLink({
        origin: "",
        workspaceShortId: "aB3kM",
        storageObjectId: objectId,
      }),
    ).toBeNull();
    expect(
      createBrandedFileLink({
        origin: "https://app.maxform.test",
        workspaceShortId: "",
        storageObjectId: objectId,
      }),
    ).toBeNull();
  });

  it("accepts the five character short ids issued at signup", () => {
    expect(workspaceShortIdPattern.test("aB3kM")).toBe(true);
    expect(workspaceShortIdPattern.test("aB3kMz")).toBe(true);
    expect(workspaceShortIdPattern.test("aB3")).toBe(false);
  });
});

describe("workspace short id backfill", () => {
  let userId = "";

  beforeEach(() => {
    // A fresh id per test keeps the process-wide cache out of the way.
    userId = `8f6a9c11-2d4e-4f0b-9a7c-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
    resetWorkspaceShortIdCacheForTests();
  });

  it("returns the id an account already has", async () => {
    const queries: string[] = [];
    const query: WorkspaceQuery = async (text) => {
      queries.push(text);
      return [{ short_id: "aB3kM" }];
    };

    await expect(ensureWorkspaceShortId(query, userId)).resolves.toBe("aB3kM");
    expect(queries).toHaveLength(1);
  });

  it("assigns one when the account predates the short id migration", async () => {
    const query: WorkspaceQuery = async (text) =>
      text.startsWith("SELECT")
        ? [{ short_id: null }]
        : [{ short_id: "kM9pq" }];

    const shortId = await ensureWorkspaceShortId(query, userId);
    expect(shortId).toBe("kM9pq");
    expect(workspaceShortIdPattern.test(shortId)).toBe(true);
  });

  it("uses the value a concurrent request assigned after a collision", async () => {
    let selects = 0;
    const query: WorkspaceQuery = async (text) => {
      if (text.startsWith("SELECT")) {
        selects += 1;
        return [{ short_id: selects === 1 ? null : "zZ7tn" }];
      }
      return [];
    };

    await expect(ensureWorkspaceShortId(query, userId)).resolves.toBe("zZ7tn");
  });

  it("returns nothing when the account row is gone", async () => {
    const query: WorkspaceQuery = async () => [];
    await expect(ensureWorkspaceShortId(query, userId)).resolves.toBe("");
  });
});

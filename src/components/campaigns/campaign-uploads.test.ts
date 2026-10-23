import { describe, expect, it } from "vitest";

import {
  MAX_FILES_PER_UPLOAD,
  MAX_WORKSPACE_ASSET_BYTES,
  acceptAttribute,
  campaignAssetRules,
  formatBytes,
  validateCampaignAsset,
} from "./campaign-uploads";

const file = (name: string, sizeMb: number) => ({
  name,
  size: Math.round(sizeMb * 1024 * 1024),
});

describe("campaign asset validation", () => {
  it("accepts each declared type within its own limit", () => {
    expect(validateCampaignAsset(file("hero.png", 9), "image")).toBeNull();
    expect(validateCampaignAsset(file("promo.mp4", 240), "video")).toBeNull();
    expect(validateCampaignAsset(file("terms.pdf", 24), "document")).toBeNull();
    expect(validateCampaignAsset(file("jingle.mp3", 49), "audio")).toBeNull();
  });

  it("holds each type to its own ceiling rather than one shared limit", () => {
    // 240 MB is fine for video and far too large for everything else.
    expect(validateCampaignAsset(file("big.png", 11), "image")).toMatch(/10 MB/);
    expect(validateCampaignAsset(file("big.mp4", 251), "video")).toMatch(
      /250 MB/,
    );
    expect(validateCampaignAsset(file("big.pdf", 26), "document")).toMatch(
      /25 MB/,
    );
    expect(validateCampaignAsset(file("big.mp3", 51), "audio")).toMatch(/50 MB/);
  });

  it("refuses executable and runnable files outright", () => {
    for (const name of [
      "payload.exe",
      "tracker.js",
      "page.html",
      "bundle.zip",
      "run.bat",
      "script.ps1",
    ]) {
      expect(validateCampaignAsset(file(name, 0.1), "image")).toMatch(
        /not allowed/,
      );
    }
  });

  it("refuses a dangerous extension before it considers the size", () => {
    // A tiny .exe is still an .exe; the message must say so, not "too large".
    expect(validateCampaignAsset(file("tiny.exe", 0.001), "image")).toMatch(
      /not allowed/,
    );
  });

  it("refuses a file whose extension belongs to a different kind", () => {
    expect(validateCampaignAsset(file("clip.mp4", 1), "image")).toMatch(
      /Choose a image file/,
    );
  });

  it("refuses a file with no extension, which cannot be checked", () => {
    expect(validateCampaignAsset(file("README", 1), "document")).toMatch(
      /no extension/,
    );
  });

  it("refuses an empty file", () => {
    expect(validateCampaignAsset({ name: "empty.png", size: 0 }, "image")).toMatch(
      /empty/,
    );
  });

  it("builds an accept attribute from the allowed extensions", () => {
    expect(acceptAttribute("image")).toBe(
      ".jpg,.jpeg,.png,.webp,.gif,.svg",
    );
    expect(acceptAttribute("video")).toBe(".mp4,.webm,.mov");
  });

  it("carries the documented per-upload and per-workspace caps", () => {
    expect(MAX_FILES_PER_UPLOAD).toBe(10);
    expect(MAX_WORKSPACE_ASSET_BYTES).toBe(500 * 1024 * 1024);
    expect(campaignAssetRules.image.maxBytes).toBe(10 * 1024 * 1024);
  });
});

describe("byte formatting", () => {
  it("reads the way a person would say the size", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(250 * 1024 * 1024)).toBe("250 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
});

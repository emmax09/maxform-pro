import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createStorageObjectKey,
  resetStorageConfigurationForTests,
  resolveStorageLocation,
  sanitizeStorageFileName,
  storageConfiguration,
  validateObjectSignature,
  validateStorageUpload,
} from "./storage-service";

const originalEnvironment = { ...process.env };

describe("Cloudflare R2 storage service", () => {
  beforeEach(() => {
    process.env.R2_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
    process.env.R2_ACCESS_KEY_ID = "test-access";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
    process.env.R2_BUCKET_NAME = "private-files";
    process.env.R2_PUBLIC_BUCKET_NAME = "public-assets";
    process.env.R2_PUBLIC_URL = "https://assets.example.test/";
    resetStorageConfigurationForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    resetStorageConfigurationForTests();
  });

  it("builds tenant-scoped keys without exposing the original name", () => {
    const key = createStorageObjectKey({
      userId: "f142cb51-34ad-43ed-9e54-018042050e40",
      purpose: "crm_attachment",
      sourceId: "9ffb6d45-16ee-4016-b7f4-0ae62e2c70db",
      fileName: "../../Quarterly Report.pdf",
    });

    expect(key).toMatch(
      /^tenants\/f142cb51-34ad-43ed-9e54-018042050e40\/crm-attachments\/9ffb6d45-16ee-4016-b7f4-0ae62e2c70db\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]+\.pdf$/,
    );
    expect(key).not.toContain("Quarterly");
  });

  it("keeps public and private buckets separate", () => {
    expect(resolveStorageLocation("private", "tenants/a/file.pdf")).toEqual({
      bucket: "private-files",
      key: "tenants/a/file.pdf",
      publicUrl: null,
      visibility: "private",
    });
    expect(resolveStorageLocation("public", "tenants/a/avatar image.png"))
      .toEqual({
        bucket: "public-assets",
        key: "tenants/a/avatar image.png",
        publicUrl:
          "https://assets.example.test/tenants/a/avatar%20image.png",
        visibility: "public",
      });
  });

  it("rejects executable and oversized form uploads", () => {
    expect(() =>
      validateStorageUpload({
        purpose: "form_response",
        visibility: "private",
        mimeType: "application/x-msdownload",
        sizeBytes: 1_024,
      }),
    ).toThrow(/type/i);
    expect(() =>
      validateStorageUpload({
        purpose: "form_response",
        visibility: "private",
        mimeType: "application/pdf",
        sizeBytes: 26 * 1024 * 1024,
      }),
    ).toThrow(/between/i);
  });

  it("checks file signatures instead of trusting the MIME header", () => {
    expect(
      validateObjectSignature(
        "application/pdf",
        Buffer.from("%PDF-1.7\n"),
      ),
    ).toBe(true);
    expect(
      validateObjectSignature(
        "application/pdf",
        Buffer.from("MZ executable"),
      ),
    ).toBe(false);
    expect(
      validateObjectSignature(
        "image/png",
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe(true);
  });

  it("normalizes unsafe display filenames", () => {
    expect(sanitizeStorageFileName("../../invoice\r\n.pdf")).toBe(
      "invoice--.pdf",
    );
  });

  it("rejects an endpoint that could receive R2 credentials", () => {
    process.env.R2_ENDPOINT = "https://storage.attacker.example";
    resetStorageConfigurationForTests();
    expect(() => storageConfiguration()).toThrow(/Cloudflare R2 endpoint/i);
  });

  it("rejects credentials placed in Vite's browser environment", () => {
    process.env.VITE_R2_SECRET_ACCESS_KEY = "must-never-reach-a-browser";
    resetStorageConfigurationForTests();
    expect(() => storageConfiguration()).toThrow(/unsafe/i);
  });

  it("requires separate public and private buckets", () => {
    process.env.R2_PUBLIC_BUCKET_NAME = "private-files";
    resetStorageConfigurationForTests();
    expect(() => storageConfiguration()).toThrow(/not separated/i);
  });
});

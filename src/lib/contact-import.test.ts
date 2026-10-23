import { describe, expect, it } from "vitest";

import {
  inferContactImportMapping,
  isContactImportMetadataHeader,
  isContactImportPhone,
  mapContactImportRows,
  parseContactImportFile,
  type ParsedContactImport,
} from "@/lib/contact-import";

describe("contact import", () => {
  it("infers common spreadsheet headings and maps preview rows", () => {
    const parsed: ParsedContactImport = {
      fileName: "contacts.csv",
      headers: ["Email Address", "Contact Name", "Mobile", "Organisation", "Tags"],
      rows: [
        [
          "ada@example.com",
          "Ada Lovelace",
          "+44 20 0000 0000",
          "Analytical Engines",
          "vip; london",
        ],
      ],
    };
    const mapping = inferContactImportMapping(parsed.headers);

    expect(mapping).toEqual({
      0: "email",
      1: "fullName",
      2: "phone",
      3: "company",
      4: "tags",
    });
    expect(mapContactImportRows(parsed, mapping)).toEqual([
      {
        company: "Analytical Engines",
        email: "ada@example.com",
        fullName: "Ada Lovelace",
        phone: "+44 20 0000 0000",
        tags: ["vip", "london"],
      },
    ]);
  });

  it("requires an email mapping", () => {
    const parsed: ParsedContactImport = {
      fileName: "contacts.xlsx",
      headers: ["Name"],
      rows: [["No email"]],
    };

    expect(() =>
      mapContactImportRows(parsed, { 0: "fullName" }),
    ).toThrow("No email column could be detected");
  });

  it("combines separate first and last name columns", () => {
    const parsed: ParsedContactImport = {
      fileName: "contacts.xlsx",
      headers: ["Email", "First Name", "Last Name"],
      rows: [["grace@example.com", "Grace", "Hopper"]],
    };
    const mapping = inferContactImportMapping(parsed.headers);

    expect(mapping).toEqual({
      0: "email",
      1: "firstName",
      2: "lastName",
    });
    expect(mapContactImportRows(parsed, mapping)[0].fullName).toBe(
      "Grace Hopper",
    );
  });

  it("identifies provider subscription metadata that should stay out of mapping", () => {
    [
      "Subscription IP",
      "Subscription time",
      "Confirmation time",
      "Confirmation IP",
      "List status",
      "Global status",
      "List",
    ].forEach((header) => {
      expect(isContactImportMetadataHeader(header)).toBe(true);
    });
    expect(isContactImportMetadataHeader("Email Address")).toBe(false);
  });

  it("detects email, first name, last name, and phone from headerless data", () => {
    const parsed: ParsedContactImport = {
      fileName: "contacts.csv",
      headers: ["Column 1", "Column 2", "Column 3", "Column 4"],
      rows: [
        ["ada@example.com", "Ada", "Lovelace", "+44 20 0000 0000"],
        ["grace@example.com", "Grace", "Hopper", "+1 (555) 010-1234"],
      ],
    };

    const mapping = inferContactImportMapping(parsed.headers, parsed.rows);

    expect(mapping).toEqual({
      0: "email",
      1: "firstName",
      2: "lastName",
      3: "phone",
    });
    expect(mapContactImportRows(parsed, mapping)[0]).toMatchObject({
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      phone: "+44 20 0000 0000",
    });
  });

  it("retains the first contact when a CSV has no headings", async () => {
    const file = new File(
      [
        [
          "azhunter94@gmail.com,,,,2025-09-09 5:37:08,,,subscribed,subscribed,Newsletter Mailing List",
          "ericagoodwin@me.com,,,,2025-09-10 8:15:00,,,subscribed,subscribed,Newsletter Mailing List",
        ].join("\n"),
      ],
      "mailing-list.csv",
      { type: "text/csv" },
    );

    const parsed = await parseContactImportFile(file);
    const mapping = inferContactImportMapping(parsed.headers, parsed.rows);

    expect(parsed.headers[0]).toBe("Column 1");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0][0]).toBe("azhunter94@gmail.com");
    expect(mapping[0]).toBe("email");
    expect(mapping[1]).toBe("firstName");
    expect(mapping[2]).toBe("lastName");
    expect(mapping[9]).toBe("skip");
    expect(mapContactImportRows(parsed, mapping)).toHaveLength(2);
  });

  it("does not mistake timestamps or IP addresses for phone numbers", () => {
    expect(isContactImportPhone("+234 801 234 5678")).toBe(true);
    expect(isContactImportPhone("2025-09-09 5:37:08")).toBe(false);
    expect(isContactImportPhone("192.168.10.24")).toBe(false);
  });
});

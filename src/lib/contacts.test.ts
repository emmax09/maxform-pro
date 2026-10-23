import { describe, expect, it } from "vitest";

import {
  contactMatchesSegment,
  contactsForList,
  type ContactListRecord,
  type ContactRecord,
} from "@/lib/contacts";

const contact: ContactRecord = {
  id: "contact-1",
  email: "ada@example.com",
  fullName: "Ada Lovelace",
  phone: "+2348000000000",
  company: "Analytical Engines",
  tags: ["customer", "newsletter"],
  customFields: {},
  lifecycleStage: "customer",
  unsubscribedAt: null,
  lastActivityAt: "2026-07-26T10:00:00.000Z",
  sourceType: "manual",
  sourceId: null,
  createdAt: "2026-07-26T10:00:00.000Z",
  updatedAt: "2026-07-26T10:00:00.000Z",
  listIds: [],
  listNames: [],
};

describe("contactMatchesSegment", () => {
  it("requires every rule to match", () => {
    expect(
      contactMatchesSegment(contact, [
        {
          field: "lifecycle_stage",
          operator: "equals",
          value: "customer",
        },
        { field: "tag", operator: "contains", value: "news" },
      ]),
    ).toBe(true);
  });

  it("supports negative matching", () => {
    expect(
      contactMatchesSegment(contact, [
        { field: "company", operator: "not_equals", value: "MaxForm" },
      ]),
    ).toBe(true);
  });
});

describe("contactsForList", () => {
  const listBase: Omit<ContactListRecord, "filterDefinition" | "id" | "listType"> =
    {
      createdAt: "2026-07-26T10:00:00.000Z",
      description: "",
      memberCount: 1,
      name: "Customers",
      updatedAt: "2026-07-26T10:00:00.000Z",
    };

  it("uses saved memberships for a static list", () => {
    const staticContact = { ...contact, listIds: ["list-1"] };
    expect(
      contactsForList([staticContact, contact], {
        ...listBase,
        filterDefinition: [],
        id: "list-1",
        listType: "static",
      }),
    ).toEqual([staticContact]);
  });

  it("evaluates live rules for a dynamic segment", () => {
    expect(
      contactsForList([contact], {
        ...listBase,
        filterDefinition: [
          { field: "lifecycle_stage", operator: "equals", value: "customer" },
        ],
        id: "segment-1",
        listType: "dynamic",
      }),
    ).toEqual([contact]);
  });
});

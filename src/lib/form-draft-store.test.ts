import { describe, expect, it, vi } from "vitest";

import type { FormRecord } from "@/components/forms/form-types";
import {
  clearFormDraft,
  restoreFormDraft,
  storeFormDraft,
} from "@/lib/form-draft-store";

const databaseForm = {
  id: "form-1",
  slug: "customer-intake",
  projectId: null,
  title: "Customer intake",
  description: "",
  fields: [],
  settings: {},
  status: "draft",
  createdBy: "user-1",
  createdAt: "2026-07-26T09:00:00.000Z",
  updatedAt: "2026-07-26T10:00:00.000Z",
  responseCount: 4,
} as FormRecord;

describe("form draft recovery", () => {
  it("restores a newer local draft without replacing database ownership metadata", () => {
    vi.setSystemTime(new Date("2026-07-26T10:05:00.000Z"));
    const draft = {
      ...databaseForm,
      title: "Updated customer intake",
      createdBy: "incorrect-user",
      responseCount: 99,
    };

    expect(storeFormDraft(localStorage, "user-1", draft)).toBe(true);
    const restored = restoreFormDraft(localStorage, "user-1", databaseForm);

    expect(restored.restored).toBe(true);
    expect(restored.form.title).toBe("Updated customer intake");
    expect(restored.form.createdBy).toBe("user-1");
    expect(restored.form.responseCount).toBe(4);
    clearFormDraft(localStorage, "user-1", databaseForm.id);
    vi.useRealTimers();
  });

  it("keeps an uncleared backup until its exact revision is acknowledged", () => {
    vi.setSystemTime(new Date("2026-07-26T09:55:00.000Z"));
    storeFormDraft(localStorage, "user-1", {
      ...databaseForm,
      title: "Unacknowledged local title",
    });

    const restored = restoreFormDraft(localStorage, "user-1", databaseForm);

    expect(restored.restored).toBe(true);
    expect(restored.form.title).toBe("Unacknowledged local title");
    clearFormDraft(localStorage, "user-1", databaseForm.id);
    expect(restoreFormDraft(localStorage, "user-1", databaseForm)).toEqual({
      form: databaseForm,
      restored: false,
    });
    vi.useRealTimers();
  });
});

import { describe, expect, it } from "vitest";

import { generateFormFromPrompt } from "./ai-form-generator";

describe("generateFormFromPrompt", () => {
  it("creates a named intake form with requested required fields", () => {
    const draft = generateFormFromPrompt(
      "Create a client intake form called Project Discovery. Collect full name, work email, company, budget, project details, and a preferred appointment. Make all fields required.",
    );

    expect(draft.title).toBe("Project Discovery");
    expect(draft.fields.some((field) => field.type === "email")).toBe(true);
    expect(draft.fields.some((field) => field.type === "appointment")).toBe(
      true,
    );
    expect(
      draft.fields
        .filter(
          (field) =>
            !["heading", "divider", "section", "pageBreak"].includes(
              field.type,
            ),
        )
        .every((field) => field.required),
    ).toBe(true);
  });

  it("uses a job application structure when hiring intent is present", () => {
    const draft = generateFormFromPrompt(
      "Build a job application for a product designer with a resume and email.",
    );

    expect(draft.title).toBe("Job application");
    expect(draft.fields.some((field) => /resume/i.test(field.label))).toBe(
      true,
    );
    expect(draft.paymentRequested).toBe(false);
  });

  it("enables payment intent for a paid event form", () => {
    const draft = generateFormFromPrompt(
      "Create a ticketed event checkout that collects attendee details and payment.",
    );

    expect(draft.paymentRequested).toBe(true);
    expect(draft.fields.length).toBeGreaterThan(2);
  });
});

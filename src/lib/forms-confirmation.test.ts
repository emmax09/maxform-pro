import { describe, expect, it } from "vitest";

import {
  defaultFormModulePreferences,
  normalizeConfirmationSettings,
  normalizeFormSettings,
} from "@/lib/forms";

describe("form confirmation settings", () => {
  it("normalizes legacy confirmation records without losing their message", () => {
    const settings = normalizeFormSettings({
      confirmation: {
        type: "message",
        message: "Legacy thank-you message",
        redirectUrl: "",
      },
    });

    expect(settings.confirmation.message).toBe("Legacy thank-you message");
    expect(settings.confirmation.useModuleDefault).toBe(false);
    expect(settings.confirmation.icon).toBe("check");
  });

  it("inherits the module default when confirmation is absent", () => {
    const settings = normalizeFormSettings({});
    expect(settings.confirmation.useModuleDefault).toBe(true);
  });

  it("clamps redirect timing and validates design enums", () => {
    const confirmation = normalizeConfirmationSettings({
      redirectDelay: 100,
      textAlign: "sideways",
      icon: "sparkle",
    });

    expect(confirmation.redirectDelay).toBe(30);
    expect(confirmation.textAlign).toBe("center");
    expect(confirmation.icon).toBe("check");
    expect(defaultFormModulePreferences.confirmation.useModuleDefault).toBe(
      false,
    );
  });
});

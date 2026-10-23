import { describe, expect, it } from "vitest";

import {
  DEFAULT_FORMS_TAB,
  FORM_TAB_ORDER,
} from "@/components/forms/form-navigation";

describe("form module navigation", () => {
  it("opens Analytics first and keeps it as the default form view", () => {
    expect(FORM_TAB_ORDER[0]).toBe("analytics");
    expect(DEFAULT_FORMS_TAB).toBe("analytics");
  });
});

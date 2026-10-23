import { describe, expect, it } from "vitest";

import { formatEmailError } from "@/lib/email-errors";

describe("formatEmailError", () => {
  it("maps stable API error codes to actionable dashboard copy", () => {
    expect(formatEmailError({
      code: "managed_sender_unavailable",
      message: "MAXFORM_MANAGED_RESEND_API_KEY is missing",
    })).toBe("MaxForm Managed Sending is temporarily unavailable. Contact your workspace administrator or choose another connected provider.");
    expect(formatEmailError({ code: "custom_domain_unverified", message: "provider detail" })).toContain("sending domain is not verified");
  });

  it("keeps useful validation guidance", () => {
    expect(formatEmailError({ message: "Enter a valid sending domain." })).toBe("Enter a valid sending domain.");
    expect(formatEmailError({ code: "invalid_sender_prefix", message: "invalid" })).toContain("lowercase sender prefix");
  });

  it("never exposes provider URLs, secrets, or structured responses", () => {
    expect(formatEmailError(new Error("Request failed: https://api.example.test/v1/send"))).toBe("Email settings could not be updated. Please try again.");
    expect(formatEmailError(new Error('provider response {"api_key":"secret-value"}'))).toBe("Email settings could not be updated. Please try again.");
    expect(formatEmailError(new Error("API key=secret-value was rejected"))).not.toContain("secret-value");
  });

  it("uses a generic message for unknown technical failures", () => {
    expect(formatEmailError(new Error("ECONNRESET at sendProvider (provider.ts:42:9)"), "The provider needs attention.")).toBe("The provider needs attention.");
  });
});

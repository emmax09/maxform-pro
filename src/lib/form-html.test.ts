import { describe, expect, it } from "vitest";

import { sanitizeFormHtml } from "@/lib/form-html";

describe("sanitizeFormHtml", () => {
  it("keeps useful formatting and removes executable content", () => {
    const sanitized = sanitizeFormHtml(
      '<p onclick="alert(1)">Hello <strong>world</strong></p><script>alert(2)</script>',
    );
    expect(sanitized).toContain("<strong>world</strong>");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("script");
  });

  it("blocks unsafe links and hardens links opened in a new tab", () => {
    expect(sanitizeFormHtml('<a href="javascript:alert(1)">Bad</a>')).not.toContain(
      "javascript:",
    );
    expect(
      sanitizeFormHtml('<a href="https://example.com" target="_blank">Good</a>'),
    ).toContain('rel="noopener noreferrer nofollow"');
  });
});

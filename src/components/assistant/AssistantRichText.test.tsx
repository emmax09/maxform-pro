import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssistantRichText } from "@/components/assistant/AssistantRichText";

describe("AssistantRichText", () => {
  it("turns model tables and emphasis into readable elements", () => {
    render(
      <AssistantRichText
        content={`| Task | What I can do |
|------|---------------|
| **Forms** | View totals and create a draft form. |`}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Task" })).toBeInTheDocument();
    expect(screen.getByText("Forms")).toBeInTheDocument();
    expect(screen.queryByText("**Forms**")).toBeNull();
    expect(screen.queryByText("------")).toBeNull();
  });

  it("renders common response blocks without exposing markdown markers", () => {
    render(
      <AssistantRichText
        content={`### Next steps

- **Connect** a provider
- Review \`workspace\` activity

> MaxAI stays scoped to this workspace.`}
      />,
    );

    expect(screen.getByRole("heading", { name: "Next steps" })).toBeInTheDocument();
    expect(screen.getByText("Connect")).toBeInTheDocument();
    expect(screen.getByText("workspace")).toBeInTheDocument();
    expect(screen.queryByText("**Connect**")).toBeNull();
  });
});


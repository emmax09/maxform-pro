import { fireEvent, render, screen } from "@testing-library/react";

import { CardGrid, PaginatedCardGrid } from "@/components/shared/CardGrid";

describe("CardGrid", () => {
  it("uses the shared responsive four-column desktop layout", () => {
    render(
      <CardGrid data-testid="card-grid">
        <div>Card</div>
      </CardGrid>,
    );

    expect(screen.getByTestId("card-grid")).toHaveClass("lg:grid-cols-4");
  });

  it("paginates card items and exposes the current range", () => {
    const items = Array.from({ length: 5 }, (_, index) => `Card ${index + 1}`);

    render(
      <PaginatedCardGrid
        items={items}
        pageSize={2}
        itemLabel="templates"
        getKey={(item) => item}
        renderItem={(item) => <div>{item}</div>}
      />,
    );

    expect(screen.getByText("Card 1")).toBeInTheDocument();
    expect(screen.getByText("Card 2")).toBeInTheDocument();
    expect(screen.queryByText("Card 3")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation")).toHaveTextContent(
      /Showing 1-2 of 5 templates/,
    );

    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));

    expect(screen.getByText("Card 3")).toBeInTheDocument();
    expect(screen.getByText("Card 4")).toBeInTheDocument();
    expect(screen.queryByText("Card 1")).not.toBeInTheDocument();
  });
});

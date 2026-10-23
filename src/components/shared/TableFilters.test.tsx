// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  TableFilterBar,
  TableFilterSelect,
  TableBulkActions,
  TablePagination,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
} from "@/components/shared/TableFilters";
import { useTableSelection } from "@/hooks/use-table-selection";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

function FilterHarness() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  return (
    <TableFilterBar>
      <TableSearchField
        value={query}
        onValueChange={setQuery}
        aria-label="Search forms"
      />
      <TableFilterSelect
        value={status}
        onValueChange={setStatus}
        label="Filter forms by status"
        options={[
          { value: "all", label: "All statuses" },
          { value: "published", label: "Published" },
        ]}
      />
    </TableFilterBar>
  );
}

function SelectionHarness() {
  const selection = useTableSelection(["one", "two"]);

  return (
    <>
      <TableSelectionBar
        totalCount={2}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="rows"
      >
        <button type="button">Bulk action</button>
      </TableSelectionBar>
      <TableRowSelect
        checked={selection.isSelected("one")}
        onCheckedChange={(checked) => selection.toggle("one", checked)}
        label="Select first row"
      />
    </>
  );
}

describe("TableFilters", () => {
  it("updates and clears the shared search field", () => {
    render(<FilterHarness />);

    const input = screen.getByLabelText("Search forms");
    fireEvent.change(input, { target: { value: "Onboarding" } });
    expect(input).toHaveValue("Onboarding");

    fireEvent.click(screen.getByLabelText("Clear search forms"));
    expect(input).toHaveValue("");
  });

  it("exposes an accessible shared filter dropdown", () => {
    render(<FilterHarness />);

    const trigger = screen.getByLabelText("Filter forms by status");
    expect(trigger).toHaveTextContent("All statuses");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Published" }));
    expect(trigger).toHaveTextContent("Published");
  });

  it("supports select all, indeterminate state, clear, and bulk actions", () => {
    const onToggleAll = vi.fn();
    const onClear = vi.fn();

    render(
      <TableSelectionBar
        totalCount={5}
        selectedCount={2}
        allSelected={false}
        partiallySelected
        onToggleAll={onToggleAll}
        onClear={onClear}
        itemLabel="records"
      >
        <button type="button">Export selected</button>
      </TableSelectionBar>,
    );

    fireEvent.click(screen.getByLabelText("Select all records"));
    expect(onToggleAll).toHaveBeenCalledWith(true);
    expect(screen.getByText("2 of 5 selected")).toBeInTheDocument();
    expect(screen.getByText("Export selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear"));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("connects row selection to select all and the bulk-action state", () => {
    render(<SelectionHarness />);

    fireEvent.click(screen.getByLabelText("Select first row"));
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    expect(screen.getByText("Bulk action")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Select all rows"));
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByText("Select all 2 rows")).toBeInTheDocument();
  });

  it("renders reusable bulk actions and modern pagination", async () => {
    const onArchive = vi.fn();
    const onPageChange = vi.fn();
    render(
      <>
        <TableBulkActions
          actions={[
            {
              key: "archive",
              label: "Archive selected",
              onSelect: onArchive,
            },
          ]}
        />
        <TablePagination
          page={2}
          pageCount={3}
          pageSize={10}
          totalCount={25}
          onPageChange={onPageChange}
          itemLabel="records"
        />
      </>,
    );

    expect(screen.getByText("Showing 11–20 of 25 records")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    fireEvent.keyDown(screen.getByRole("button", { name: "Bulk actions" }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Archive selected" }),
    );
    expect(onArchive).toHaveBeenCalledOnce();
  });
});

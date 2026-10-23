import * as React from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  ListChecks,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type TableFilterBarProps = React.ComponentPropsWithoutRef<"div"> & {
  label?: string;
};

const TableFilterBar = React.forwardRef<HTMLDivElement, TableFilterBarProps>(
  ({ className, label = "Table filters", children, ...props }, ref) => (
    <div
      ref={ref}
      role="search"
      aria-label={label}
      className={cn(
        "flex w-full flex-col gap-2 rounded-xl border border-border/80 bg-card/70 p-2 shadow-xs sm:flex-row sm:items-center dark:bg-card/45",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
TableFilterBar.displayName = "TableFilterBar";

type TableSearchFieldProps = Omit<
  React.ComponentPropsWithoutRef<"input">,
  "onChange" | "size" | "value"
> & {
  value: string;
  onValueChange: (value: string) => void;
  wrapperClassName?: string;
};

const TableSearchField = React.forwardRef<
  HTMLInputElement,
  TableSearchFieldProps
>(
  (
    {
      "aria-label": ariaLabel = "Search table",
      className,
      disabled,
      onValueChange,
      placeholder = "Search",
      value,
      wrapperClassName,
      ...props
    },
    ref,
  ) => (
    <div
      className={cn(
        "group relative min-w-0 flex-1 rounded-lg bg-muted/45 ring-1 ring-inset ring-border/70 transition-[background-color,box-shadow] focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/25",
        wrapperClassName,
      )}
    >
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-foreground"
        aria-hidden="true"
      />
      <Input
        {...props}
        ref={ref}
        type="search"
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          "h-10 rounded-lg border-0 bg-transparent pl-10 pr-10 text-[12px] shadow-none outline-hidden ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-search-cancel-button]:appearance-none",
          className,
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onValueChange("")}
          disabled={disabled}
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50"
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  ),
);
TableSearchField.displayName = "TableSearchField";

export type TableFilterOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

type TableFilterSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: TableFilterOption[];
  label: string;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
};

function TableFilterSelect({
  value,
  onValueChange,
  options,
  label,
  placeholder,
  className,
  contentClassName,
  disabled,
}: TableFilterSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-10 min-w-0 rounded-lg border-border/80 bg-background/80 px-3 text-[12px] font-medium shadow-none transition-colors hover:bg-accent/40 focus:ring-2 focus:ring-primary/25 focus:ring-offset-0 sm:w-[180px] [&>svg:last-child]:h-3.5 [&>svg:last-child]:w-3.5",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ListFilter
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <SelectValue placeholder={placeholder} />
        </span>
      </SelectTrigger>
      <SelectContent
        align="start"
        className={cn("rounded-xl border-border/80 p-1", contentClassName)}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="rounded-lg text-[12px]"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type TableSelectionBarProps = {
  totalCount: number;
  selectedCount: number;
  allSelected: boolean;
  partiallySelected?: boolean;
  onToggleAll: (checked: boolean) => void;
  onClear: () => void;
  itemLabel?: string;
  children?: React.ReactNode;
  className?: string;
};

export type TableBulkAction = {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
};

function TableBulkActions({
  actions,
  label = "Bulk actions",
}: {
  actions: TableBulkAction[];
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 rounded-lg border-primary/25 bg-primary/6 px-2.5 text-primary shadow-xs transition-[background-color,border-color,box-shadow] hover:border-primary/40 hover:bg-primary/12 hover:text-primary focus-visible:ring-primary/30"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/15">
            <ListChecks className="h-3.5 w-3.5" />
          </span>
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-52 rounded-xl border-border/80 bg-popover/95 p-1.5 shadow-xl"
      >
        {actions.map((action) => (
          <React.Fragment key={action.key}>
            {action.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              disabled={action.disabled}
              onClick={action.onSelect}
              className={cn(
                "gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium",
                action.destructive &&
                  "text-destructive focus:bg-destructive/10 focus:text-destructive",
              )}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TableSelectionBar({
  totalCount,
  selectedCount,
  allSelected,
  partiallySelected = false,
  onToggleAll,
  onClear,
  itemLabel = "items",
  children,
  className,
}: TableSelectionBarProps) {
  if (totalCount === 0) return null;

  return (
    <div
      className={cn(
        "flex min-h-11 flex-col gap-2 rounded-xl border px-3 py-2 sm:flex-row sm:items-center sm:justify-between",
        selectedCount
          ? "border-primary/30 bg-primary/5.5"
          : "border-border/70 bg-muted/25",
        className,
      )}
      aria-live="polite"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Checkbox
          checked={
            partiallySelected && !allSelected ? "indeterminate" : allSelected
          }
          onCheckedChange={(checked) => onToggleAll(checked === true)}
          aria-label={
            allSelected
              ? `Deselect all ${itemLabel}`
              : `Select all ${itemLabel}`
          }
        />
        <span className="text-[11px] font-medium text-foreground">
          {selectedCount
            ? `${selectedCount} of ${totalCount} selected`
            : `Select all ${totalCount} ${itemLabel}`}
        </span>
        {selectedCount ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Clear
          </button>
        ) : null}
      </div>
      {selectedCount && children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

type TablePaginationProps = {
  page: number;
  pageCount: number;
  pageSize?: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  className?: string;
};

function TablePagination({
  page,
  pageCount,
  pageSize = 10,
  totalCount,
  onPageChange,
  itemLabel = "items",
  className,
}: TablePaginationProps) {
  if (totalCount <= pageSize) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);
  const firstPage = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pages = Array.from(
    { length: Math.min(5, pageCount) },
    (_, index) => firstPage + index,
  ).filter((item) => item <= pageCount);

  return (
    <nav
      aria-label={`${itemLabel} pagination`}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-[10px] font-medium text-muted-foreground">
        Showing {start}–{end} of {totalCount} {itemLabel}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        {pages.map((item) => (
          <Button
            key={item}
            type="button"
            size="icon"
            variant={item === page ? "secondary" : "ghost"}
            className="h-8 w-8 text-[10px]"
            onClick={() => onPageChange(item)}
            aria-label={`Page ${item}`}
            aria-current={item === page ? "page" : undefined}
          >
            {item}
          </Button>
        ))}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </nav>
  );
}

type TableRowSelectProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  className?: string;
};

function TableRowSelect({
  checked,
  onCheckedChange,
  label,
  className,
}: TableRowSelectProps) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={label}
      />
    </span>
  );
}

export {
  TableFilterBar,
  TableFilterSelect,
  TableBulkActions,
  TablePagination,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
};

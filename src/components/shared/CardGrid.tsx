import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The shared layout for card collections across the dashboard.
 *
 * Four columns is the desktop baseline. The smaller breakpoints are kept
 * intentionally simple so cards never become unreadably narrow.
 */
export function CardGrid({
  children,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type CardGridPaginationProps = {
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  className?: string;
};

function pageNumbers(page: number, pageCount: number) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  return Array.from(pages)
    .filter((item) => item >= 1 && item <= pageCount)
    .sort((left, right) => left - right);
}

/** A compact, accessible pagination bar designed for card collections. */
export function CardGridPagination({
  page,
  pageCount,
  pageSize,
  totalCount,
  onPageChange,
  itemLabel = "items",
  className,
}: CardGridPaginationProps) {
  if (totalCount <= pageSize || pageCount <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);
  const pages = pageNumbers(page, pageCount);
  const pageItems: Array<number | "ellipsis"> = [];

  pages.forEach((item, index) => {
    const previous = pages[index - 1];
    if (previous && item - previous > 1) pageItems.push("ellipsis");
    pageItems.push(item);
  });

  return (
    <nav
      aria-label={`${itemLabel} pagination`}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border/80 bg-card/75 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-[11px] font-medium text-muted-foreground">
        Showing <span className="text-foreground">{start}-{end}</span> of{" "}
        <span className="text-foreground">{totalCount}</span> {itemLabel}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px]"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        {pageItems.map((item, index) =>
          item === "ellipsis" ? (
            <span
              key={`ellipsis-${index}`}
              className="flex h-8 w-8 items-center justify-center text-muted-foreground"
              aria-hidden="true"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </span>
          ) : (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={item === page ? "default" : "ghost"}
              className="h-8 w-8 rounded-lg p-0 text-[11px]"
              onClick={() => onPageChange(item)}
              aria-label={`Page ${item}`}
              aria-current={item === page ? "page" : undefined}
            >
              {item}
            </Button>
          ),
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px]"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

export type PaginatedCardGridProps<T> = {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  getKey?: (item: T, index: number) => string | number;
  pageSize?: number;
  itemLabel?: string;
  emptyState?: ReactNode;
  resetKey?: string | number | boolean | null;
  className?: string;
  paginationClassName?: string;
};

/**
 * Render and paginate any card collection with one component.
 * The page is reset when a caller changes resetKey (for example, a search
 * or filter), and is clamped when the collection gets smaller after a save.
 */
export function PaginatedCardGrid<T>({
  items,
  renderItem,
  getKey,
  pageSize = 12,
  itemLabel = "items",
  emptyState = null,
  resetKey = null,
  className,
  paginationClassName,
}: PaginatedCardGridProps<T>) {
  const safePageSize = Math.max(1, pageSize);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const visiblePage = Math.min(page, pageCount);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const pageItems = useMemo(
    () =>
      items.slice(
        (visiblePage - 1) * safePageSize,
        visiblePage * safePageSize,
      ),
    [items, safePageSize, visiblePage],
  );

  if (items.length === 0) return <>{emptyState}</>;

  return (
    <div className="space-y-4">
      <CardGrid className={className}>
        {pageItems.map((item, index) => {
          const absoluteIndex = (visiblePage - 1) * safePageSize + index;
          const key = getKey?.(item, absoluteIndex) ?? absoluteIndex;
          return <Fragment key={key}>{renderItem(item, absoluteIndex)}</Fragment>;
        })}
      </CardGrid>
      <CardGridPagination
        page={visiblePage}
        pageCount={pageCount}
        pageSize={safePageSize}
        totalCount={items.length}
        onPageChange={setPage}
        itemLabel={itemLabel}
        className={paginationClassName}
      />
    </div>
  );
}

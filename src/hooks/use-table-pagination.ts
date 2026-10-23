import { useEffect, useMemo, useState } from "react";

function useTablePagination<T>(
  items: T[],
  pageSize = 10,
  resetKey = "",
) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [currentPage, items, pageSize]);

  return {
    page: currentPage,
    pageCount,
    pageItems,
    pageSize,
    setPage: (nextPage: number) =>
      setPage(Math.max(1, Math.min(nextPage, pageCount))),
    totalCount: items.length,
  };
}

export { useTablePagination };

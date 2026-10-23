import { useEffect, useState } from "react";

function useTableSelection(visibleIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const visibleKey = visibleIds.join("\u0000");
  const visibleIdSet = new Set(visibleIds);
  const selectedVisibleIds = selectedIds.filter((id) => visibleIdSet.has(id));
  const allSelected =
    visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length;

  useEffect(() => {
    const nextVisibleIds = new Set(
      visibleKey ? visibleKey.split("\u0000") : [],
    );
    setSelectedIds((current) => {
      const next = current.filter((id) => nextVisibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [visibleKey]);

  const toggle = (id: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((itemId) => itemId !== id),
    );
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? Array.from(new Set([...current, ...visibleIds]))
        : current.filter((id) => !visibleIdSet.has(id)),
    );
  };

  return {
    allSelected,
    clearSelection: () => setSelectedIds([]),
    isSelected: (id: string) => selectedIds.includes(id),
    partiallySelected:
      selectedVisibleIds.length > 0 &&
      selectedVisibleIds.length < visibleIds.length,
    selectedIds,
    selectedVisibleIds,
    toggle,
    toggleAll,
  };
}

export { useTableSelection };

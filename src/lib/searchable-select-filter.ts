const normalizeSearchText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function searchableSelectFilter(value: string, search: string) {
  const haystack = normalizeSearchText(value);
  const needle = normalizeSearchText(search);
  if (!needle) return 1;

  const [code = ""] = haystack.split(" ");
  if (code === needle) return 1;
  if (code.startsWith(needle)) return 0.98;
  if (haystack.includes(needle)) return 0.9;

  const words = haystack.split(/[\s,()/.+-]+/).filter(Boolean);
  const terms = needle.split(" ").filter(Boolean);
  if (terms.every((term) => words.some((word) => word.startsWith(term)))) {
    return 0.75;
  }
  if (terms.every((term) => haystack.includes(term))) return 0.6;
  return 0;
}

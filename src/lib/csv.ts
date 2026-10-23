type CsvValue = string | number | boolean | null | undefined;

const csvCell = (value: CsvValue) =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;

function downloadCsvFile(
  filename: string,
  headings: string[],
  rows: CsvValue[][],
) {
  const content = [headings, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", content], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function timestampedCsvFilename(name: string, date = new Date()) {
  const safeName =
    name
      .trim()
      .replace(/[<>:"/\\|?*]/g, "-")
      .split("")
      .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
      .join("")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[.\s-]+|[.\s-]+$/g, "") || "contacts";
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  ].join("_");
  return `${safeName}_${timestamp}.csv`;
}

export { downloadCsvFile, timestampedCsvFilename };

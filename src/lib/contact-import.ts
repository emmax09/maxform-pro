export type ContactImportTarget =
  | "skip"
  | "email"
  | "fullName"
  | "firstName"
  | "lastName"
  | "phone"
  | "company"
  | "tags";

export type ContactImportMapping = Record<number, ContactImportTarget>;

/** The fields a spreadsheet column can be mapped onto, in menu order. */
export const contactImportTargetOptions: Array<{
  value: ContactImportTarget;
  label: string;
}> = [
  { value: "skip", label: "Do not import" },
  { value: "email", label: "Email" },
  { value: "fullName", label: "Full name" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "phone", label: "Phone" },
  { value: "company", label: "Company" },
  { value: "tags", label: "Tags" },
];

export type ContactImportRow = {
  email: string;
  fullName: string;
  phone: string;
  company: string;
  tags: string[];
};

export type ParsedContactImport = {
  fileName: string;
  headers: string[];
  rows: string[][];
};

const normalizedHeader = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const contactImportMetadataHeaders = new Set([
  "confirmationip",
  "confirmationtime",
  "globalstatus",
  "list",
  "liststatus",
  "subscriptionip",
  "subscriptiontime",
]);

export const isContactImportMetadataHeader = (header: string) =>
  contactImportMetadataHeaders.has(normalizedHeader(header));

const targetAliases: Record<Exclude<ContactImportTarget, "skip">, string[]> = {
  email: [
    "email",
    "emailaddress",
    "emailid",
    "primaryemail",
    "workemail",
    "contactemail",
  ],
  fullName: [
    "name",
    "fullname",
    "contactname",
    "customername",
    "displayname",
  ],
  firstName: ["first", "firstname", "givenname", "forename", "fname"],
  lastName: [
    "last",
    "lastname",
    "surname",
    "familyname",
    "secondname",
    "lname",
  ],
  phone: [
    "phone",
    "phonenumber",
    "primaryphone",
    "workphone",
    "mobile",
    "mobilephone",
    "mobilenumber",
    "telephone",
    "tel",
    "cell",
    "cellphone",
    "contactnumber",
    "whatsapp",
    "whatsappnumber",
  ],
  company: [
    "company",
    "companyname",
    "organization",
    "organisation",
    "business",
    "businessname",
  ],
  tags: ["tags", "tag", "labels"],
};

const importTargets = Object.entries(targetAliases) as Array<
  [Exclude<ContactImportTarget, "skip">, string[]]
>;

const targetFromHeader = (header: string) => {
  if (isContactImportMetadataHeader(header)) return null;
  const normalized = normalizedHeader(header);
  return (
    importTargets.find(([, aliases]) => aliases.includes(normalized))?.[0] ||
    null
  );
};

export const isContactImportEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const isDateLike = (value: string) =>
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[T\s].*)?$/.test(value.trim()) ||
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?:[T\s].*)?$/.test(value.trim());

const isIpAddress = (value: string) => {
  const parts = value.trim().split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
    )
  );
};

export const isContactImportPhone = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || isDateLike(trimmed) || isIpAddress(trimmed)) return false;
  if (/[a-wyz]/i.test(trimmed.replace(/\b(?:ext|extension|x)\b/gi, ""))) {
    return false;
  }
  if (!/^[+\d().\-\s/x]+$/i.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
};

const columnValues = (rows: string[][], index: number) =>
  rows
    .slice(0, 200)
    .map((row) => row[index]?.trim() || "")
    .filter(Boolean);

const bestContentColumn = (
  headers: string[],
  rows: string[][],
  mappedColumns: Set<number>,
  predicate: (value: string) => boolean,
) => {
  let bestIndex = -1;
  let bestScore = 0;
  headers.forEach((header, index) => {
    if (mappedColumns.has(index) || isContactImportMetadataHeader(header)) {
      return;
    }
    const values = columnValues(rows, index);
    if (values.length === 0) return;
    const matches = values.filter(predicate).length;
    const score = matches / values.length + Math.min(matches, 10) / 100;
    if (matches > 0 && score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestScore >= 0.6 ? bestIndex : -1;
};

const isGenericHeader = (header: string, index: number) =>
  normalizedHeader(header) === `column${index + 1}`;

const likelyNameValues = (values: string[]) => {
  if (values.length === 0) return false;
  if (
    values.length > 1 &&
    new Set(values.map((value) => value.trim().toLowerCase())).size === 1
  ) {
    return false;
  }
  const statusValues = new Set([
    "active",
    "bounced",
    "cleaned",
    "confirmed",
    "inactive",
    "pending",
    "subscribed",
    "unsubscribed",
  ]);
  const matches = values.filter((value) => {
    const trimmed = value.trim();
    const words = trimmed.split(/\s+/);
    return (
      !statusValues.has(trimmed.toLowerCase()) &&
      !isDateLike(trimmed) &&
      !isIpAddress(trimmed) &&
      !isContactImportEmail(trimmed) &&
      !isContactImportPhone(trimmed) &&
      words.length <= 4 &&
      /^[\p{L}][\p{L}'’.\-\s]*$/u.test(trimmed)
    );
  }).length;
  return matches / values.length >= 0.7;
};

export const inferContactImportMapping = (
  headers: string[],
  rows: string[][] = [],
): ContactImportMapping => {
  const used = new Set<ContactImportTarget>();
  const mapping = Object.fromEntries(
    headers.map((header, index) => {
      const inferred = targetFromHeader(header);
      const target = inferred && !used.has(inferred) ? inferred : "skip";
      if (target !== "skip") used.add(target);
      return [index, target];
    }),
  ) as ContactImportMapping;

  const mappedColumns = new Set(
    Object.entries(mapping)
      .filter(([, target]) => target !== "skip")
      .map(([index]) => Number(index)),
  );

  if (!used.has("email")) {
    const emailIndex = bestContentColumn(
      headers,
      rows,
      mappedColumns,
      isContactImportEmail,
    );
    if (emailIndex >= 0) {
      mapping[emailIndex] = "email";
      mappedColumns.add(emailIndex);
      used.add("email");
    }
  }

  if (!used.has("phone")) {
    const phoneIndex = bestContentColumn(
      headers,
      rows,
      mappedColumns,
      isContactImportPhone,
    );
    if (phoneIndex >= 0) {
      mapping[phoneIndex] = "phone";
      mappedColumns.add(phoneIndex);
      used.add("phone");
    }
  }

  const hasMappedName =
    used.has("fullName") || used.has("firstName") || used.has("lastName");
  if (!hasMappedName) {
    const genericHeaders = headers.every(isGenericHeader);
    const emailIndex = Number(
      Object.entries(mapping).find(([, target]) => target === "email")?.[0] ??
        -1,
    );
    const candidates = headers
      .map((_, index) => index)
      .filter((index) => !mappedColumns.has(index))
      .filter((index) => {
        const values = columnValues(rows, index);
        return (
          (genericHeaders &&
            (index === emailIndex + 1 || index === emailIndex + 2) &&
            values.length === 0) ||
          likelyNameValues(values)
        );
      })
      .sort((left, right) => {
        const leftDistance = Math.abs(left - emailIndex);
        const rightDistance = Math.abs(right - emailIndex);
        return leftDistance - rightDistance || left - right;
      });

    const fullNameCandidates = genericHeaders
      ? candidates.slice(0, 2)
      : candidates;
    const fullNameIndex = fullNameCandidates.find((index) => {
      const values = columnValues(rows, index);
      return (
        values.length > 0 &&
        values.filter((value) => value.trim().split(/\s+/).length > 1).length /
          values.length >=
          0.6
      );
    });
    if (fullNameIndex != null) {
      mapping[fullNameIndex] = "fullName";
    } else {
      if (candidates[0] != null) mapping[candidates[0]] = "firstName";
      if (candidates[1] != null) mapping[candidates[1]] = "lastName";
    }
  }

  return mapping;
};

const delimiterCounts = (line: string) => {
  const counts = new Map([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    if (!quoted && counts.has(character)) {
      counts.set(character, (counts.get(character) || 0) + 1);
    }
  }
  return counts;
};

const csvDelimiter = (text: string) => {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  return Array.from(delimiterCounts(firstLine).entries()).sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0] || ",";
};

const parseCsvMatrix = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const delimiter = csvDelimiter(text);

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const matrixHasHeader = (matrix: string[][]) => {
  const firstRow = matrix[0] || [];
  const recognizedHeaders = firstRow.filter(
    (value) => targetFromHeader(value) || isContactImportMetadataHeader(value),
  ).length;
  if (recognizedHeaders > 0) return true;
  if (
    firstRow.some(
      (value) =>
        isContactImportEmail(value) ||
        isContactImportPhone(value) ||
        isDateLike(value) ||
        isIpAddress(value),
    )
  ) {
    return false;
  }
  return matrix
    .slice(1, 20)
    .some((row) => row.some((value) => isContactImportEmail(value)));
};

const cellText = (value: unknown) => {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

const readFileText = (file: File) => {
  if (typeof file.text === "function") return file.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () =>
      reject(reader.error || new Error("The contact file could not be read")),
    );
    reader.readAsText(file);
  });
};

export const parseContactImportFile = async (
  file: File,
): Promise<ParsedContactImport> => {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Choose a file smaller than 10 MB");
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  let matrix: string[][];

  if (extension === "csv") {
    matrix = parseCsvMatrix(await readFileText(file));
  } else if (extension === "xlsx") {
    const { default: readXlsxFile } = await import(
      "read-excel-file/browser"
    );
    const rows = (await readXlsxFile(file)) as unknown as unknown[][];
    matrix = rows.map((row) => row.map(cellText));
  } else {
    throw new Error("Choose a CSV or Excel (.xlsx) file");
  }

  const populated = matrix.filter((row) => row.some((cell) => cell.trim()));
  if (populated.length === 0) {
    throw new Error("The file does not contain any contacts");
  }
  const hasHeader = matrixHasHeader(populated);
  const columnCount = Math.max(...populated.map((row) => row.length));
  const headers = hasHeader
    ? Array.from(
        { length: columnCount },
        (_, index) =>
          populated[0]?.[index]?.trim() || `Column ${index + 1}`,
      )
    : Array.from(
        { length: columnCount },
        (_, index) => `Column ${index + 1}`,
      );
  const dataRows = hasHeader ? populated.slice(1) : populated;
  if (dataRows.length === 0) {
    throw new Error("The file does not contain any contacts");
  }
  if (dataRows.length > 5_000) {
    throw new Error("Import up to 5,000 contacts at a time");
  }

  const rows = dataRows.map((row) =>
    headers.map((_, index) => row[index]?.trim() || ""),
  );

  return { fileName: file.name, headers, rows };
};

export const mapContactImportRows = (
  parsed: ParsedContactImport,
  mapping: ContactImportMapping,
): ContactImportRow[] => {
  const targetIndex = (target: ContactImportTarget) =>
    Number(
      Object.entries(mapping).find(([, value]) => value === target)?.[0] ?? -1,
    );
  const emailIndex = targetIndex("email");
  if (emailIndex < 0) {
    throw new Error("No email column could be detected");
  }

  const nameIndex = targetIndex("fullName");
  const firstNameIndex = targetIndex("firstName");
  const lastNameIndex = targetIndex("lastName");
  const phoneIndex = targetIndex("phone");
  const companyIndex = targetIndex("company");
  const tagsIndex = targetIndex("tags");

  return parsed.rows.map((values) => {
    const fullName = nameIndex >= 0 ? values[nameIndex]?.trim() || "" : "";
    const splitName = [
      firstNameIndex >= 0 ? values[firstNameIndex]?.trim() || "" : "",
      lastNameIndex >= 0 ? values[lastNameIndex]?.trim() || "" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      email: values[emailIndex] || "",
      fullName: fullName || splitName,
      phone: phoneIndex >= 0 ? values[phoneIndex] || "" : "",
      company: companyIndex >= 0 ? values[companyIndex] || "" : "",
      tags:
        tagsIndex >= 0
          ? (values[tagsIndex] || "")
              .split(/[;,|]/)
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [],
    };
  });
};

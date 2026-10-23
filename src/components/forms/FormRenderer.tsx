import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileUp,
  Image,
  Minus,
  Plus,
  ShoppingCart,
  PenLine,
  Trash2,
} from "lucide-react";

import {
  type FormAnswerValue,
  type FormBlockStyle,
  type FormField,
  type FormFileAnswer,
  type FormLogicRule,
  type FormRecord,
  type FormSignatureAnswer,
} from "@/components/forms/form-types";
import { ensureFormFontLoaded } from "@/components/forms/form-fonts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { resolveCalculatedAnswer } from "@/lib/form-calculations";
import { sanitizeFormHtml } from "@/lib/form-html";
import { colorToHslChannels, publicThemeVariables } from "@/lib/public-theme";
import { cn } from "@/lib/utils";

type FormRendererProps = {
  checkoutSummary?: {
    amount: number;
    currency: string;
    label: string;
  };
  couponsEnabled?: boolean;
  form: FormRecord;
  compact?: boolean;
  onSubmit?: (answers: Record<string, FormAnswerValue>) => void;
  preview?: boolean;
  submitting?: boolean;
};

const conditionMatches = (
  rule: FormLogicRule,
  answers: Record<string, FormAnswerValue>,
) => {
  const answer = answers[rule.sourceFieldId];
  const normalized = Array.isArray(answer)
    ? answer.map((item) =>
        typeof item === "object" ? JSON.stringify(item) : String(item),
      ).join(", ")
    : answer && typeof answer === "object"
      ? Object.values(answer).join(", ")
      : String(answer ?? "");
  switch (rule.operator) {
    case "equals":
      return normalized === rule.value;
    case "not_equals":
      return normalized !== rule.value;
    case "contains":
      return normalized.toLowerCase().includes(rule.value.toLowerCase());
    case "greater_than":
      return Number(answer) > Number(rule.value);
    case "less_than":
      return Number(answer) < Number(rule.value);
    case "is_answered":
      return normalized.trim().length > 0;
    default:
      return false;
  }
};

function isFieldVisible(
  fieldId: string,
  logic: FormLogicRule[],
  answers: Record<string, FormAnswerValue>,
) {
  const rules = logic.filter(
    (rule) =>
      rule.targetFieldId === fieldId &&
      (rule.action === "show" || rule.action === "hide"),
  );
  return rules.every((rule) => {
    const matches = conditionMatches(rule, answers);
    return rule.action === "show" ? matches : !matches;
  });
}

function isFieldRequired(
  field: FormField,
  logic: FormLogicRule[],
  answers: Record<string, FormAnswerValue>,
) {
  return (
    Boolean(field.required) ||
    logic.some(
      (rule) =>
        rule.targetFieldId === field.id &&
        rule.action === "require" &&
        conditionMatches(rule, answers),
    )
  );
}

const styleColor = (value: string | undefined, fallback?: string) =>
  value?.trim() || fallback;

const styleNumber = (
  fallback: number,
  ...values: Array<number | undefined>
) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, value);
    }
  }
  return fallback;
};

const blockSideValue = (
  fallback: number,
  fieldSide: number | undefined,
  fieldAll: number | undefined,
  formSide: number | undefined,
  formAll: number | undefined,
) => styleNumber(fallback, fieldSide, fieldAll, formSide, formAll);

const resolveFieldBlockStyle = ({
  fieldStyle,
  formRadius,
  formStyle,
}: {
  fieldStyle?: FormBlockStyle;
  formRadius: number;
  formStyle?: FormBlockStyle;
}) => {
  const explicitBorderColor = styleColor(
    fieldStyle?.borderColor,
    formStyle?.borderColor,
  );
  const borderColor = styleColor(explicitBorderColor, "var(--form-border)");
  const borderChannels = explicitBorderColor
    ? colorToHslChannels(explicitBorderColor, "#E0E2E7")
    : undefined;
  const borderWidth = styleNumber(
    0,
    fieldStyle?.borderWidth,
    formStyle?.borderWidth,
  );
  const borderRadius = styleNumber(
    formRadius,
    fieldStyle?.borderRadius,
    formStyle?.borderRadius,
  );
  const paddingTop = blockSideValue(
    0,
    fieldStyle?.paddingTop,
    fieldStyle?.padding,
    formStyle?.paddingTop,
    formStyle?.padding,
  );
  const paddingRight = blockSideValue(
    0,
    fieldStyle?.paddingRight,
    fieldStyle?.padding,
    formStyle?.paddingRight,
    formStyle?.padding,
  );
  const paddingBottom = blockSideValue(
    0,
    fieldStyle?.paddingBottom,
    fieldStyle?.padding,
    formStyle?.paddingBottom,
    formStyle?.padding,
  );
  const paddingLeft = blockSideValue(
    0,
    fieldStyle?.paddingLeft,
    fieldStyle?.padding,
    formStyle?.paddingLeft,
    formStyle?.padding,
  );
  const marginTop = blockSideValue(
    0,
    fieldStyle?.marginTop,
    fieldStyle?.margin,
    formStyle?.marginTop,
    formStyle?.margin,
  );
  const marginRight = blockSideValue(
    0,
    fieldStyle?.marginRight,
    fieldStyle?.margin,
    formStyle?.marginRight,
    formStyle?.margin,
  );
  const marginBottom = blockSideValue(
    0,
    fieldStyle?.marginBottom,
    fieldStyle?.margin,
    formStyle?.marginBottom,
    formStyle?.margin,
  );
  const marginLeft = blockSideValue(
    0,
    fieldStyle?.marginLeft,
    fieldStyle?.margin,
    formStyle?.marginLeft,
    formStyle?.margin,
  );
  const fieldTextColor = styleColor(
    fieldStyle?.textColor,
    styleColor(formStyle?.textColor, "var(--form-fg)"),
  );
  const labelColor = styleColor(fieldStyle?.labelColor, fieldTextColor);
  const helpTextColor = styleColor(
    fieldStyle?.helpTextColor,
    styleColor(formStyle?.helpTextColor, "var(--form-muted)"),
  );
  const inputBackgroundColor = styleColor(
    fieldStyle?.inputBackgroundColor,
    styleColor(
      fieldStyle?.backgroundColor,
      styleColor(formStyle?.inputBackgroundColor, "var(--form-control-bg)"),
    ),
  );
  const inputTextColor = styleColor(fieldStyle?.inputTextColor, fieldTextColor);
  const inputBorderColor = styleColor(
    fieldStyle?.inputBorderColor,
    styleColor(
      fieldStyle?.borderColor,
      styleColor(formStyle?.inputBorderColor, "var(--form-control-border)"),
    ),
  );
  const inputBorderWidth = styleNumber(
    1,
    fieldStyle?.inputBorderWidth,
    formStyle?.inputBorderWidth,
  );
  const inputBorderRadius = styleNumber(
    formRadius,
    fieldStyle?.inputBorderRadius,
    formStyle?.inputBorderRadius,
  );
  const fieldFontSize = fieldStyle?.fontSize ?? formStyle?.fontSize;
  const fieldFontWeight = fieldStyle?.fontWeight ?? formStyle?.fontWeight;
  const fieldFontFamily = fieldStyle?.fontFamily ?? formStyle?.fontFamily;
  const fieldLineHeight = fieldStyle?.lineHeight ?? formStyle?.lineHeight;
  const fieldBorderStyle =
    fieldStyle?.borderStyle ||
    formStyle?.borderStyle ||
    (borderWidth > 0 ? "solid" : "none");
  const inputBorderStyle =
    fieldStyle?.inputBorderStyle ||
    formStyle?.inputBorderStyle ||
    fieldStyle?.borderStyle ||
    formStyle?.borderStyle ||
    "solid";

  return {
    ...(borderChannels
      ? { "--border": borderChannels, "--input": borderChannels }
      : {}),
    "--form-block-border": borderColor,
    "--form-border": borderColor,
    "--form-field-text": fieldTextColor,
    "--form-field-label": labelColor,
    "--form-field-help": helpTextColor,
    "--form-field-placeholder": styleColor(
      fieldStyle?.placeholderColor,
      styleColor(formStyle?.placeholderColor, "var(--form-control-placeholder)"),
    ),
    "--form-field-input-bg": inputBackgroundColor,
    "--form-field-input-text": inputTextColor,
    "--form-field-input-border": inputBorderColor,
    "--form-field-input-border-width": `${inputBorderWidth}px`,
    "--form-field-input-border-style": inputBorderStyle,
    "--form-field-input-radius": `${inputBorderRadius}px`,
    "--form-field-font-size": fieldFontSize
      ? `${fieldFontSize}px`
      : "var(--form-font-size)",
    "--form-field-font-weight": fieldFontWeight
      ? String(fieldFontWeight)
      : "var(--form-font-weight)",
    "--form-field-font-family": fieldFontFamily || "inherit",
    "--form-field-line-height": fieldLineHeight
      ? String(fieldLineHeight)
      : "var(--form-line-height)",
    backgroundColor: styleColor(
      fieldStyle?.backgroundColor,
      styleColor(formStyle?.backgroundColor),
    ),
    borderColor,
    borderRadius,
    borderStyle: fieldBorderStyle === "none" ? undefined : fieldBorderStyle,
    borderWidth,
    color: fieldTextColor,
    marginTop: marginTop || undefined,
    marginRight: marginRight || undefined,
    marginBottom: marginBottom || undefined,
    marginLeft: marginLeft || undefined,
    paddingTop: paddingTop || undefined,
    paddingRight: paddingRight || undefined,
    paddingBottom: paddingBottom || undefined,
    paddingLeft: paddingLeft || undefined,
  } as CSSProperties;
};

function useRespondentPrefersDark() {
  const [prefersDark, setPrefersDark] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setPrefersDark(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return prefersDark;
}

function FieldLabel({
  field,
  required,
}: {
  field: FormField;
  required: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={`response-${field.id}`}
        className="maxform-field-label text-[14px] font-medium"
      >
        {field.label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      {field.helpText && (
        <p className="maxform-field-help mt-1 text-[12px] opacity-65">
          {field.helpText}
        </p>
      )}
    </div>
  );
}

const isFileAnswer = (
  value: FormAnswerValue | undefined,
): value is FormFileAnswer =>
  Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.kind === "file",
  );

const isFilesAnswer = (
  value: FormAnswerValue | undefined,
): value is FormFileAnswer[] =>
  Array.isArray(value) && value.every((item) => isFileAnswer(item));

const structuredAnswer = (value: FormAnswerValue | undefined) =>
  value && typeof value === "object" && !Array.isArray(value) && !("kind" in value)
    ? value
    : {};

const isSignatureAnswer = (
  value: FormAnswerValue | undefined,
): value is FormSignatureAnswer =>
  Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.kind === "signature",
  );

const nonResponseFieldTypes = new Set([
  "divider",
  "heading",
  "html",
  "pageBreak",
  "section",
  "orderSummary",
]);

const answerPartIsComplete = (value: unknown) => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(answerPartIsComplete);
  }
  if (typeof value === "object") {
    return Object.values(value).length > 0 && Object.values(value).every(answerPartIsComplete);
  }
  return false;
};

const requiredAnswerIsComplete = (
  field: FormField,
  value: FormAnswerValue | undefined,
) => {
  if (value == null) return false;
  if (field.type === "signature") {
    return isSignatureAnswer(value) && Boolean(value.dataUrl?.trim());
  }
  if (field.type === "file") return isFileAnswer(value);
  if (field.type === "multipleFiles") {
    return isFilesAnswer(value) && value.length > 0;
  }
  if (field.type === "matrix") {
    const answer = structuredAnswer(value);
    const rows = field.config?.matrixRows || [];
    return rows.length > 0 && rows.every((row) => answerPartIsComplete(answer[row]));
  }
  if (field.type === "address") {
    const answer = structuredAnswer(value);
    return ["street", "city", "country"].every((key) =>
      answerPartIsComplete(answer[key]),
    );
  }
  if (field.type === "location") {
    const answer = structuredAnswer(value);
    const latitude = Number(answer.latitude);
    const longitude = Number(answer.longitude);
    return (
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
    );
  }
  if (field.type === "product") {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (item) =>
          item &&
          typeof item === "object" &&
          "productId" in item &&
          answerPartIsComplete(item.productId) &&
          "quantity" in item &&
          Number(item.quantity) > 0,
      )
    );
  }
  return answerPartIsComplete(value);
};

const fileAccept = (field: FormField) => {
  if (field.type === "camera") return "image/*";
  switch (field.config?.acceptedFileTypes) {
    case "images":
      return "image/*";
    case "documents":
      return ".pdf,.doc,.docx,.txt,.rtf,.xls,.xlsx,.csv";
    case "pdf":
      return "application/pdf,.pdf";
    default:
      return undefined;
  }
};

const formatFileSize = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;

const inferredMimeType = (file: File) => {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    {
      csv: "text/csv",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      pdf: "application/pdf",
      png: "image/png",
      rtf: "application/rtf",
      txt: "text/plain",
      webp: "image/webp",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    } as Record<string, string>
  )[extension || ""] || "application/octet-stream";
};

const fileMatchesField = (field: FormField, file: File) => {
  const mimeType = inferredMimeType(file);
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (field.type === "camera") return mimeType.startsWith("image/");
  switch (field.config?.acceptedFileTypes) {
    case "images":
      return mimeType.startsWith("image/");
    case "pdf":
      return mimeType === "application/pdf" || extension === "pdf";
    case "documents":
      return [
        "csv",
        "doc",
        "docx",
        "pdf",
        "rtf",
        "txt",
        "xls",
        "xlsx",
      ].includes(extension);
    default:
      return true;
  }
};

const ticketAnswer = (value: FormAnswerValue | undefined) => {
  const fallback = { name: String(value || ""), quantity: 1 };
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed = JSON.parse(value) as { name?: unknown; quantity?: unknown };
    const name = String(parsed.name || "");
    const quantity = Number(parsed.quantity);
    return {
      name,
      quantity: Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1,
    };
  } catch {
    return fallback;
  }
};

const encodeTicketAnswer = (name: string, quantity: number) =>
  JSON.stringify({ name, quantity });

const formatCurrency = (value: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
};

const parseDateValue = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const toDateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateValue = (value: string) => {
  const date = parseDateValue(value);
  return date
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)
    : "";
};

const calendarThemeVariables = (themeMode: "light" | "dark") =>
  ({
    "--accent": themeMode === "dark" ? "240 4% 14%" : "0 0% 96%",
    "--accent-foreground": themeMode === "dark" ? "0 0% 90%" : "0 0% 9%",
    "--background": themeMode === "dark" ? "240 6% 6%" : "0 0% 100%",
    "--border": themeMode === "dark" ? "240 4% 26%" : "0 0% 88%",
    "--foreground": themeMode === "dark" ? "0 0% 90%" : "0 0% 9%",
    "--input": themeMode === "dark" ? "240 4% 26%" : "0 0% 88%",
    "--muted-foreground": themeMode === "dark" ? "0 0% 50%" : "0 0% 40%",
    "--popover": themeMode === "dark" ? "240 5% 9%" : "0 0% 100%",
    "--popover-foreground": themeMode === "dark" ? "0 0% 90%" : "0 0% 9%",
    "--primary": "215 16% 47%",
    "--primary-foreground": "0 0% 100%",
    "--ring": themeMode === "dark" ? "215 14% 55%" : "215 16% 47%",
  }) as CSSProperties;

function DatePickerControl({
  ariaLabel,
  id,
  onChange,
  placeholder = "Pick a date",
  required,
  themeMode,
  value,
}: {
  ariaLabel: string;
  id: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required: boolean;
  themeMode: "light" | "dark";
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            className="flex h-10 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-[14px] shadow-none transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--form-accent)] focus-visible:ring-offset-2"
            style={{
              backgroundColor:
                "var(--form-field-input-bg, var(--form-control-bg))",
              borderColor:
                "var(--form-field-input-border, var(--form-control-border))",
              borderRadius:
                "var(--form-field-input-radius, var(--form-radius))",
              color:
                "var(--form-field-input-text, var(--form-control-fg))",
            }}
            aria-haspopup="dialog"
          >
            <span className={cn("truncate", !selected && "opacity-55")}>
              {selected ? formatDateValue(value) : placeholder}
            </span>
            <CalendarDays className="h-4 w-4 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto p-0"
          style={calendarThemeVariables(themeMode)}
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              if (!date) return;
              onChange(toDateValue(date));
              setOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <input
        aria-label={ariaLabel}
        className="sr-only"
        value={value}
        required={required}
        readOnly
        tabIndex={-1}
      />
    </div>
  );
}

function FileResponseField({
  field,
  onChange,
  required,
  value,
}: {
  field: FormField;
  onChange: (value: FormAnswerValue) => void;
  required: boolean;
  value: FormAnswerValue | undefined;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const answer = isFileAnswer(value) ? value : null;
  const maximumMb = Math.min(
    10,
    Math.max(1, field.config?.maxFileSizeMb || 5),
  );
  const id = `response-${field.id}`;

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (file.size > maximumMb * 1024 * 1024) {
      setError(`Choose a file smaller than ${maximumMb} MB.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (!fileMatchesField(field, file)) {
      setError("Choose one of the accepted file types.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    onChange({
      kind: "file",
      file,
      fileName: file.name,
      mimeType: inferredMimeType(file),
      size: file.size,
    });
  };

  useEffect(() => {
    if (!answer?.mimeType.startsWith("image/")) {
      setPreviewUrl("");
      return;
    }
    if (
      answer.file &&
      typeof URL !== "undefined" &&
      typeof URL.createObjectURL === "function"
    ) {
      const url = URL.createObjectURL(answer.file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(answer.dataUrl || "");
  }, [answer]);

  const clear = () => {
    if (inputRef.current) inputRef.current.value = "";
    onChange("");
    setError("");
  };

  return (
    <div className="space-y-2">
      <FieldLabel field={field} required={required} />
      {answer ? (
        <div className="overflow-hidden border" style={{ borderRadius: "var(--form-radius)" }}>
          {answer.mimeType.startsWith("image/") && (
            <img
              src={previewUrl || undefined}
              alt={`Preview of ${answer.fileName}`}
              className="max-h-[260px] w-full object-contain"
            />
          )}
          <div className="flex min-w-0 items-center gap-3 p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-current/5">
              {answer.mimeType.startsWith("image/") ? (
                <Image className="h-4 w-4 opacity-65" />
              ) : (
                <FileUp className="h-4 w-4 opacity-65" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium">
                {answer.fileName}
              </p>
              <p className="mt-0.5 text-[10px] opacity-60">
                {formatFileSize(answer.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="px-2 py-1 text-[11px] font-medium underline-offset-4 hover:underline"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={clear}
              className="flex h-8 w-8 items-center justify-center opacity-60 hover:opacity-100"
              aria-label={`Remove ${answer.fileName}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={id}
          className="flex min-h-[112px] cursor-pointer flex-col items-center justify-center border border-dashed px-4 text-center transition-colors hover:bg-current/5"
          style={{ borderRadius: "var(--form-radius)" }}
        >
          {field.type === "camera" ? (
            <Image className="h-5 w-5 opacity-60" />
          ) : (
            <FileUp className="h-5 w-5 opacity-60" />
          )}
          <span className="mt-2 text-[12px] font-medium">
            {field.type === "camera"
              ? "Take or choose a photo"
              : "Choose a file"}
          </span>
          <span className="mt-1 text-[10px] opacity-55">
            Maximum {maximumMb} MB
          </span>
        </label>
      )}
      <input
        ref={inputRef}
        id={id}
        type="file"
        className="sr-only"
        accept={fileAccept(field)}
        capture={field.type === "camera" ? "environment" : undefined}
        required={required && !answer}
        onChange={(event) => chooseFile(event.target.files?.[0])}
      />
      {error && (
        <p className="text-[11px] text-rose-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function MultipleFilesResponseField({
  field,
  onChange,
  required,
  value,
}: {
  field: FormField;
  onChange: (value: FormAnswerValue) => void;
  required: boolean;
  value: FormAnswerValue | undefined;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const answers = isFilesAnswer(value) ? value : [];
  const maximumMb = Math.min(10, Math.max(1, field.config?.maxFileSizeMb || 5));
  const maximumFiles = Math.min(20, Math.max(2, field.config?.maxFiles || 5));
  const id = `response-${field.id}`;

  const chooseFiles = (selected: FileList | null) => {
    if (!selected?.length) return;
    setError("");
    const available = maximumFiles - answers.length;
    const files = Array.from(selected).slice(0, Math.max(0, available));
    if (selected.length > available) {
      setError(`You can upload up to ${maximumFiles} files.`);
    }
    const invalid = files.find(
      (file) =>
        file.size > maximumMb * 1024 * 1024 || !fileMatchesField(field, file),
    );
    if (invalid) {
      setError(
        invalid.size > maximumMb * 1024 * 1024
          ? `${invalid.name} is larger than ${maximumMb} MB.`
          : `${invalid.name} is not an accepted file type.`,
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    onChange([
      ...answers,
      ...files.map((file) => ({
        kind: "file" as const,
        file,
        fileName: file.name,
        mimeType: inferredMimeType(file),
        size: file.size,
      })),
    ]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <FieldLabel field={field} required={required} />
      {answers.length > 0 && (
        <div className="divide-y overflow-hidden border" style={{ borderRadius: "var(--form-radius)" }}>
          {answers.map((answer, index) => (
            <div key={`${answer.fileName}-${index}`} className="flex min-w-0 items-center gap-3 p-3">
              <FileUp className="h-4 w-4 shrink-0 opacity-60" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">{answer.fileName}</p>
                <p className="mt-0.5 text-[10px] opacity-60">{formatFileSize(answer.size)}</p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${answer.fileName}`}
                className="flex h-8 w-8 items-center justify-center opacity-60 hover:opacity-100"
                onClick={() => onChange(answers.filter((_, itemIndex) => itemIndex !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      {answers.length < maximumFiles && (
        <label
          htmlFor={id}
          className="flex min-h-[92px] cursor-pointer flex-col items-center justify-center border border-dashed px-4 text-center transition-colors hover:bg-current/5"
          style={{ borderRadius: "var(--form-radius)" }}
        >
          <FileUp className="h-5 w-5 opacity-60" />
          <span className="mt-2 text-[12px] font-medium">Choose files</span>
          <span className="mt-1 text-[10px] opacity-55">
            {answers.length} of {maximumFiles} selected · {maximumMb} MB each
          </span>
        </label>
      )}
      <input
        ref={inputRef}
        id={id}
        type="file"
        multiple
        className="sr-only"
        accept={fileAccept(field)}
        required={required && answers.length === 0}
        onChange={(event) => chooseFiles(event.target.files)}
      />
      {error && <p className="text-[11px] text-rose-600" role="alert">{error}</p>}
    </div>
  );
}

function SignatureResponseField({
  field,
  onChange,
  required,
  value,
}: {
  field: FormField;
  onChange: (value: FormAnswerValue) => void;
  required: boolean;
  value: FormAnswerValue | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const answer = isSignatureAnswer(value) ? value : null;
  const penColor = field.config?.signaturePenColor || "#111827";
  const backgroundColor =
    field.config?.signatureBackgroundColor || "#FFFFFF";

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!answer?.dataUrl) return;
    const image = new window.Image();
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = answer.dataUrl;
  }, [answer?.dataUrl, backgroundColor]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * canvas.width,
      y: ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * canvas.height,
    };
  };

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    drawing.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const next = point(event);
    context.beginPath();
    context.moveTo(next.x, next.y);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = penColor;
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.stroke();
  };

  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = event.currentTarget;
    onChange({
      kind: "signature",
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    });
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    onChange("");
  };

  return (
    <div className="space-y-2">
      <FieldLabel field={field} required={required} />
      <div
        className="overflow-hidden border"
        style={{ borderRadius: "var(--form-radius)" }}
      >
        <canvas
          ref={canvasRef}
          width={900}
          height={240}
          className="h-[160px] w-full cursor-crosshair touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          aria-label={`${field.label} signature pad`}
        />
        <div className="flex items-center justify-between border-t px-3 py-2">
          <span className="flex items-center gap-2 text-[10px] opacity-60">
            <PenLine className="h-3.5 w-3.5" />
            Draw with a mouse, pen, or finger
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={!answer}
            className="text-[11px] font-medium opacity-65 hover:opacity-100 disabled:opacity-30"
          >
            Clear
          </button>
        </div>
      </div>
      <input
        className="sr-only"
        tabIndex={-1}
        aria-label={`${field.label} captured value`}
        value={answer?.dataUrl || ""}
        required={required}
        readOnly
      />
    </div>
  );
}

function ProductResponseField({
  currency,
  field,
  required,
  value,
  onChange,
}: {
  currency: string;
  field: FormField;
  required: boolean;
  value: FormAnswerValue | undefined;
  onChange: (value: FormAnswerValue) => void;
}) {
  const selectedProductIds = field.config?.productIds || [];
  const products = (field.config?.catalogProducts || []).filter((product) =>
    selectedProductIds.includes(product.id),
  );
  const display = field.config?.productDisplay || {};
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const selections = Array.isArray(value)
    ? value.filter(
        (item): item is { productId: string; variantId?: string; quantity: number } =>
          Boolean(item && typeof item === "object" && "productId" in item),
      )
    : [];
  // Quantity limits belong to the catalog product so the same product behaves
  // consistently everywhere it is reused. Keep the field-level values only as
  // legacy data; they are no longer allowed to cap a product checkout.
  const minimum = 1;
  const configuredMaximum = 1000;
  const effectivePrice = (product: (typeof products)[number], variant?: (typeof products)[number]["variants"][number]) => {
    const regular = variant?.price ?? product.price;
    const sale = variant?.salePrice ?? product.salePrice;
    return sale != null && sale >= 0 && sale < regular ? sale : regular;
  };
  const productIsSoldOut = (product: (typeof products)[number], variant?: (typeof products)[number]["variants"][number]) => {
    const available = variant?.availableQuantity ?? product.availableQuantity;
    const backorders = variant?.allowBackorder ?? product.allowBackorder;
    const now = Date.now();
    const startsAt = variant?.availabilityStartAt || product.availabilityStartAt;
    const endsAt = variant?.availabilityEndAt || product.availabilityEndAt;
    const starts = startsAt ? new Date(startsAt).getTime() : NaN;
    const ends = endsAt ? new Date(endsAt).getTime() : NaN;
    return product.status === "sold_out" ||
      (Number.isFinite(starts) && now < starts) ||
      (Number.isFinite(ends) && now >= ends) ||
      (available === 0 && !backorders);
  };
  const updateSelection = (
    productId: string,
    patch: Partial<{ variantId: string; quantity: number }> | null,
  ) => {
    const current = selections.find((selection) => selection.productId === productId);
    let next = selections.filter((selection) => selection.productId !== productId);
    if (patch) {
      const product = products.find((item) => item.id === productId);
      if (!product) return;
      const variantId = patch.variantId ?? current?.variantId ?? product.variants[0]?.id;
      const selectedVariant = variantId
        ? product.variants.find((variant) => variant.id === variantId)
        : undefined;
      const productMinimum = Math.max(minimum, product.minQuantity ?? minimum);
      const productMaximum = Math.min(
        configuredMaximum,
        Math.max(productMinimum, product.maxQuantity ?? configuredMaximum),
      );
      const available = selectedVariant?.availableQuantity ?? product.availableQuantity;
      const allowBackorder = selectedVariant?.allowBackorder ?? product.allowBackorder;
      const stockMaximum = available == null || allowBackorder
        ? productMaximum
        : Math.max(0, Math.min(productMaximum, available));
      const quantity = field.config?.showProductQuantity === false
        ? 1
        : Math.min(
            stockMaximum,
            Math.max(productMinimum, Math.floor(patch.quantity ?? current?.quantity ?? productMinimum)),
          );
      if (quantity > 0 && !productIsSoldOut(product, selectedVariant)) {
        const selection = {
          productId,
          ...(variantId ? { variantId } : {}),
          quantity,
        };
        next = field.config?.allowMultipleProducts === false ? [selection] : [...next, selection];
      }
    }
    onChange(next);
  };
  const visibleProducts = products.filter((product) => {
    if (display.hideSoldOutProducts === false) return true;
    if (product.variants.length > 0) {
      return product.variants.some((variant) => !productIsSoldOut(product, variant));
    }
    return !productIsSoldOut(product);
  });
  const style = display.style || "cards";
  const columns = Math.min(4, Math.max(1, display.columns || 2));
  const gridClass = style === "list" || style === "compact"
    ? "grid gap-3"
    : style === "large"
      ? "grid gap-4 sm:grid-cols-2"
      : `grid gap-3 ${columns >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : ""}`;
  const cardImageClass = display.imageAspectRatio === "portrait"
    ? "aspect-[3/4]"
    : display.imageAspectRatio === "landscape"
      ? "aspect-[16/9]"
      : "aspect-square";
  const selectedTotal = selections.reduce((sum, selection) => {
    const product = products.find((item) => item.id === selection.productId);
    const variant = product?.variants.find((item) => item.id === selection.variantId);
    return sum + (product ? effectivePrice(product, variant) * selection.quantity : 0);
  }, 0);

  if (products.length === 0) {
    return (
      <fieldset className="space-y-3">
        <FieldLabel field={field} required={required} />
        <div className="flex min-h-28 flex-col items-center justify-center rounded-md border border-dashed px-4 text-center opacity-70">
          <Image className="h-5 w-5" />
          <p className="mt-2 text-[12px] font-medium">Products are being configured</p>
          <p className="mt-1 text-[10px]">This store will appear when products are added.</p>
        </div>
        <input className="sr-only" tabIndex={-1} value="" required={required} readOnly aria-label={`${field.label} product selection status`} />
      </fieldset>
    );
  }

  return (
    <fieldset className="space-y-4">
      <FieldLabel field={field} required={required} />
      <div className={gridClass}>
        {visibleProducts.map((product) => {
          const selected = selections.find((item) => item.productId === product.id);
          const selectedVariant = product.variants.find((variant) => variant.id === selected?.variantId);
          const available = selectedVariant?.availableQuantity ?? product.availableQuantity;
          const backorders = selectedVariant?.allowBackorder ?? product.allowBackorder;
          const soldOut = productIsSoldOut(product, selectedVariant);
          const unitPrice = effectivePrice(product, selectedVariant);
          const regularPrice = selectedVariant?.price ?? product.price;
          const images = Array.from(
            new Set([product.imageUrl, ...(product.imageGallery || [])].filter(Boolean)),
          );
          const isImageStyle = style === "image";
          return (
            <article
              key={product.id}
              className={cn(
                "min-w-0 overflow-hidden border transition-shadow",
                selected && "border-current ring-1 ring-current",
                style === "compact" && "flex items-center gap-3 p-3",
                style === "list" && "grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]",
              )}
              style={{
                backgroundColor: display.cardBackground || undefined,
                borderColor: selected ? "currentColor" : display.cardBorderColor || undefined,
                borderRadius: `${display.cardBorderRadius ?? 12}px`,
                padding: style === "compact" ? undefined : `${display.cardPadding ?? 12}px`,
              }}
            >
              {style !== "compact" && (
                images[0] ? (
                  <button
                    type="button"
                    className={cn("group relative block w-full overflow-hidden", cardImageClass, isImageStyle && "cursor-zoom-in")}
                    onClick={() => setLightbox({ images, index: 0 })}
                    aria-label={`View ${product.name} images`}
                  >
                    <img src={images[0]} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
                    {images.length > 1 && <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white">+{images.length - 1} photos</span>}
                  </button>
                ) : (
                  <div className={cn("flex w-full items-center justify-center bg-muted/60 text-muted-foreground", cardImageClass)} aria-label={`${product.name} has no image`}>
                    <Image className="h-7 w-7 opacity-60" />
                  </div>
                )
              )}
              {images.length > 1 && style !== "compact" && style !== "list" && (
                <div className="mt-2 flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
                  {images.slice(0, 5).map((image, imageIndex) => (
                    <button
                      key={`${image}-${imageIndex}`}
                      type="button"
                      className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-current/20 opacity-80 transition-opacity hover:opacity-100"
                      onClick={() => setLightbox({ images, index: imageIndex })}
                      aria-label={`View ${product.name} image ${imageIndex + 1}`}
                    >
                      <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <div className={cn("space-y-3", style === "compact" && "min-w-0 flex-1", style === "list" && "self-center")}>
                <div className={cn("flex items-start justify-between gap-3", display.textAlignment === "center" && "text-center")}>
                  <div className="min-w-0 flex-1">
                    {product.promotionalBanner && <span className="mb-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{product.promotionalBanner}</span>}
                    {(product.categories?.length || product.category) && <p className="text-[10px] uppercase tracking-wide opacity-55">{product.categories?.join(" · ") || product.category}</p>}
                    <p className="text-[13px] font-semibold">{product.name}</p>
                    {(product.shortDescription || product.description) && <p className="mt-1 line-clamp-3 text-[11px] opacity-65">{product.shortDescription || product.description}</p>}
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                    {formatCurrency(unitPrice, product.currency)}
                    {unitPrice < regularPrice && <span className="ml-1 text-[10px] font-normal text-muted-foreground line-through">{formatCurrency(regularPrice, product.currency)}</span>}
                  </span>
                </div>
                {product.variants.length > 0 && (
                  <Select
                    value={selected?.variantId || product.variants[0]?.id}
                    onValueChange={(variantId) => updateSelection(product.id, { variantId, quantity: selected?.quantity || 1 })}
                  >
                    <SelectTrigger aria-label={`${product.name} variation`}><SelectValue placeholder="Choose a variation" /></SelectTrigger>
                    <SelectContent>
                      {product.variants.map((variant) => {
                        const variantSoldOut = productIsSoldOut(product, variant);
                        return (
                          <SelectItem key={variant.id} value={variant.id} disabled={variantSoldOut}>
                            {variant.name} · {formatCurrency(effectivePrice(product, variant), product.currency)}
                            {variant.availableQuantity != null ? ` · ${variant.availableQuantity} left` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
                {selected ? (
                  <div className="flex items-center justify-between gap-3">
                    {field.config?.showProductQuantity !== false ? (
                      <div className="flex items-center border">
                        <button type="button" className="flex h-9 w-9 items-center justify-center" aria-label={`Decrease ${product.name} quantity`} onClick={() => selected.quantity <= Math.max(minimum, product.minQuantity || 1) ? updateSelection(product.id, null) : updateSelection(product.id, { quantity: selected.quantity - 1 })}><Minus className="h-3.5 w-3.5" /></button>
                        <span className="min-w-9 text-center text-[12px] tabular-nums">{selected.quantity}</span>
                        <button type="button" className="flex h-9 w-9 items-center justify-center disabled:opacity-30" aria-label={`Increase ${product.name} quantity`} disabled={available != null && !backorders && selected.quantity >= available} onClick={() => updateSelection(product.id, { quantity: selected.quantity + 1 })}><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                    ) : <span className="text-[11px] opacity-65">Quantity 1</span>}
                    <button type="button" className="text-[11px] font-medium underline underline-offset-4" onClick={() => updateSelection(product.id, null)}>Remove</button>
                  </div>
                ) : (
                  <Button type="button" variant={display.selectionStyle === "button" ? "default" : "outline"} className="w-full" disabled={soldOut} onClick={() => updateSelection(product.id, { quantity: 1 })} aria-pressed={Boolean(selected)}>
                    {display.selectionStyle === "checkbox" ? <span className="h-4 w-4 rounded border border-current" aria-hidden="true" /> : display.selectionStyle === "radio" ? <span className="h-4 w-4 rounded-full border border-current" aria-hidden="true" /> : <ShoppingCart className="h-4 w-4" />}
                    {soldOut ? "Out of stock" : "Add to order"}
                  </Button>
                )}
                {available != null && available > 0 && available <= 5 && <p className="text-[10px] font-medium text-amber-600">Only {available} remaining</p>}
              </div>
            </article>
          );
        })}
      </div>
      {display.showOrderSummary !== false && selections.length > 0 && (
        <div className="space-y-2 border-t pt-4" style={{ borderColor: "var(--form-control-border)" }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-semibold">Order summary</p>
            <p className="text-[13px] font-semibold tabular-nums">{formatCurrency(selectedTotal, currency)}</p>
          </div>
          <div className="space-y-1">
            {selections.map((selection) => {
              const product = products.find((item) => item.id === selection.productId);
              const variant = product?.variants.find((item) => item.id === selection.variantId);
              if (!product) return null;
              return <div key={`${selection.productId}:${selection.variantId || ""}`} className="flex justify-between gap-3 text-[11px] opacity-70"><span>{selection.quantity} × {product.name}{variant ? ` · ${variant.name}` : ""}</span><span className="tabular-nums">{formatCurrency(effectivePrice(product, variant) * selection.quantity, currency)}</span></div>;
            })}
          </div>
        </div>
      )}
      <input className="sr-only" tabIndex={-1} value={selections.length ? "answered" : ""} required={required} readOnly aria-label={`${field.label} product selection status`} />
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-5" role="dialog" aria-label="Product image preview" onClick={() => setLightbox(null)}>
          <button type="button" className="absolute right-5 top-5 rounded-full bg-white/10 px-3 py-2 text-sm text-white" onClick={() => setLightbox(null)}>Close</button>
          <img src={lightbox.images[lightbox.index]} alt="" className="max-h-[85vh] max-w-[92vw] object-contain" onClick={(event) => event.stopPropagation()} />
          {lightbox.images.length > 1 && <>
            <button type="button" className="absolute left-5 rounded-full bg-white/10 p-3 text-white" onClick={(event) => { event.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index - 1 + lightbox.images.length) % lightbox.images.length }); }} aria-label="Previous product image"><ChevronLeft className="h-5 w-5" /></button>
            <button type="button" className="absolute right-5 top-1/2 rounded-full bg-white/10 p-3 text-white" onClick={(event) => { event.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index + 1) % lightbox.images.length }); }} aria-label="Next product image"><ChevronRight className="h-5 w-5" /></button>
          </>}
        </div>
      )}
    </fieldset>
  );
}

function ResponseField({
  currency,
  field,
  required,
  themeMode,
  value,
  onChange,
}: {
  currency: string;
  field: FormField;
  required: boolean;
  themeMode: "light" | "dark";
  value: FormAnswerValue | undefined;
  onChange: (value: FormAnswerValue) => void;
}) {
  const id = `response-${field.id}`;
  const options = field.options || ["Option 1", "Option 2", "Option 3"];

  if (field.type === "heading") {
    return (
      <div>
        <h2 className="text-[22px] font-semibold">{field.label}</h2>
        {field.helpText && (
          <p className="mt-2 text-[13px] opacity-65">{field.helpText}</p>
        )}
      </div>
    );
  }

  if (field.type === "section") {
    return (
      <div className="border-b pb-3">
        <h3 className="text-[17px] font-semibold">{field.label}</h3>
        {field.helpText && (
          <p className="mt-1 text-[12px] opacity-65">{field.helpText}</p>
        )}
      </div>
    );
  }

  if (field.type === "divider") {
    return <div className="border-t" aria-hidden="true" />;
  }

  if (field.type === "html") {
    return (
      <div
        className="prose prose-sm max-w-none text-current [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4"
        dangerouslySetInnerHTML={{
          __html: sanitizeFormHtml(field.defaultValue || field.helpText || ""),
        }}
      />
    );
  }

  if (field.type === "hidden") {
    return null;
  }

  if (field.type === "calculated") {
    return (
      <div className="space-y-2">
        <FieldLabel field={field} required={false} />
        <Input
          value={String(value ?? "")}
          readOnly
          className="bg-current/5 tabular-nums"
          aria-label={`${field.label} calculated value`}
        />
      </div>
    );
  }

  const label = <FieldLabel field={field} required={required} />;

  if (field.type === "longText") {
    return (
      <div className="space-y-2">
        {label}
        <Textarea
          id={id}
          value={String(value || "")}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          required={required}
          className="min-h-[112px] bg-transparent"
        />
      </div>
    );
  }

  if (
    field.type === "shortText" ||
    field.type === "email" ||
    field.type === "number" ||
    field.type === "url" ||
    field.type === "password" ||
    field.type === "time"
  ) {
    const inputType = {
      shortText: "text",
      email: "email",
      number: "number",
      url: "url",
      password: "password",
      time: "time",
    }[field.type];
    return (
      <div className="space-y-2">
        {label}
        <Input
          id={id}
          type={inputType}
          value={String(value || "")}
          onChange={(event) =>
            onChange(
              field.type === "number"
                ? event.target.value === ""
                  ? ""
                  : Number(event.target.value)
                : event.target.value,
            )
          }
          min={field.validation?.min}
          max={field.validation?.max}
          minLength={field.validation?.minLength}
          maxLength={field.validation?.maxLength}
          placeholder={field.placeholder}
          required={required}
          className="bg-transparent"
        />
      </div>
    );
  }

  if (field.type === "date") {
    return (
      <div className="space-y-2">
        {label}
        <DatePickerControl
          id={id}
          ariaLabel={`${field.label} selected date`}
          value={String(value || "")}
          onChange={onChange}
          placeholder={field.placeholder || "Pick a date"}
          required={required}
          themeMode={themeMode}
        />
      </div>
    );
  }

  if (field.type === "phone") {
    return (
      <div className="space-y-2">
        {label}
        <PhoneInput
          id={id}
          value={String(value || "")}
          onChange={(nextValue) => onChange(nextValue || "")}
          placeholder={field.placeholder}
          required={required}
          overlayTheme={themeMode}
          className="[&_input]:border-[var(--form-border)] [&_input]:bg-transparent [&_button]:border-[var(--form-border)]"
        />
      </div>
    );
  }

  if (field.id === "ticket-selection" && field.config?.ticketLimits) {
    const selected = ticketAnswer(value);
    const limits = field.config.ticketLimits;
    const selectedLimit = limits[selected.name];
    const selectedMax = selectedLimit
      ? Math.max(
          selectedLimit.min,
          Math.min(selectedLimit.max, selectedLimit.remaining),
        )
      : 1;
    const selectedQuantity = Math.max(
      selectedLimit?.min || 1,
      Math.min(selected.quantity, selectedMax),
    );
    return (
      <fieldset className="space-y-3">
        {label}
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const limit = limits[option];
            const unavailable = !limit || limit.remaining < limit.min;
            const active = selected.name === option;
            return (
              <button
                key={option}
                type="button"
                disabled={unavailable}
                onClick={() =>
                  onChange(
                    encodeTicketAnswer(
                      option,
                      Math.max(1, limit?.min || 1),
                    ),
                  )
                }
                className={cn(
                  "relative flex min-h-[76px] items-start justify-between gap-4 rounded-lg border px-4 py-3 text-left text-[13px] transition",
                  active && "border-current bg-current/5 shadow-sm",
                  unavailable && "cursor-not-allowed opacity-45",
                )}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-semibold">
                    {limit?.color && (
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: limit.color }}
                      />
                    )}
                    {option}
                  </span>
                  {limit?.description && (
                    <span className="mt-1 block line-clamp-2 text-[11px] leading-4 opacity-65">
                      {limit.description}
                    </span>
                  )}
                  <span className="mt-1.5 block text-[10px] opacity-55">
                    {unavailable
                      ? "Unavailable"
                      : `${limit.remaining.toLocaleString()} remaining`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 font-semibold">
                  {limit
                    ? limit.price
                      ? formatCurrency(
                          limit.price,
                          limit.currency || currency,
                        )
                      : "Free"
                    : ""}
                  {active && (
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-current text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {selected.name && selectedLimit && (
          <div className="flex items-center justify-between gap-4 rounded-md border border-current/20 bg-current/5 px-3 py-3">
            <div>
              <p className="text-[12px] font-medium">Number of tickets</p>
              <p className="mt-1 text-[11px] opacity-65">
                Choose between {selectedLimit.min} and {selectedMax} for this ticket type.
              </p>
              {typeof selectedLimit.price === "number" && (
                <p className="mt-1 text-[11px] font-medium">
                  Total: {selectedLimit.price
                    ? formatCurrency(
                        selectedLimit.price * selectedQuantity,
                        selectedLimit.currency || currency,
                      )
                    : "Free"}
                </p>
              )}
            </div>
            <Input
              id={`${id}-quantity`}
              type="number"
              min={selectedLimit.min}
              max={selectedMax}
              value={selectedQuantity}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                const quantity = Number.isFinite(parsed)
                  ? Math.max(selectedLimit.min, Math.min(selectedMax, Math.floor(parsed)))
                  : selectedLimit.min;
                onChange(encodeTicketAnswer(selected.name, quantity));
              }}
              className="w-24 bg-transparent text-center"
            />
          </div>
        )}
        <input
          className="sr-only"
          tabIndex={-1}
          value={selected.name}
          required={required}
          readOnly
          aria-label={`${field.label} selection status`}
        />
      </fieldset>
    );
  }

  if (field.type === "dateRange") {
    const parts = String(value || "|").split("|");
    return (
      <div className="space-y-2">
        {label}
        <div className="grid gap-2 sm:grid-cols-2">
          <DatePickerControl
            id={id}
            ariaLabel={`${field.label} start date`}
            value={parts[0] || ""}
            onChange={(date) => onChange(`${date}|${parts[1] || ""}`)}
            required={required}
            themeMode={themeMode}
            placeholder="Start date"
          />
          <DatePickerControl
            id={`${id}-end`}
            ariaLabel={`${field.label} end date`}
            value={parts[1] || ""}
            onChange={(date) => onChange(`${parts[0] || ""}|${date}`)}
            required={required}
            themeMode={themeMode}
            placeholder="End date"
          />
        </div>
      </div>
    );
  }

  if (field.type === "dropdown" || field.type === "appointment") {
    const availableOptions =
      field.type === "appointment" && !field.options?.length
        ? ["09:00", "10:30", "13:00", "15:30"]
        : options;
    return (
      <div className="space-y-2">
        {label}
        <Select
          value={String(value || "")}
          onValueChange={onChange}
          name={id}
          required={required}
        >
          <SelectTrigger
            id={id}
            aria-label={field.label}
            className="h-10 bg-transparent text-[14px] shadow-none"
            style={{ color: "inherit" }}
          >
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent themeMode={themeMode}>
            {availableOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.type === "radio" || field.type === "yesNo") {
    const availableOptions = field.type === "yesNo" ? ["Yes", "No"] : options;
    return (
      <fieldset className="space-y-3">
        {label}
        <div className="grid gap-2 sm:grid-cols-2">
          {availableOptions.map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-[13px]",
                value === option && "border-current bg-current/5",
              )}
            >
              <input
                type="radio"
                name={field.id}
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
                required={required}
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (field.type === "checkboxes" || field.type === "multiSelect") {
    // These fields answer with plain option strings. Narrowing to those keeps
    // the comparisons below well typed -- an array answer could otherwise hold
    // file or product entries, which are never options of this field.
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
    return (
      <fieldset className="space-y-3">
        {label}
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-[13px]",
                selected.includes(option) && "border-current bg-current/5",
              )}
            >
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option]
                      : selected.filter((item) => item !== option),
                  )
                }
              />
              {option}
            </label>
          ))}
        </div>
        <input
          className="sr-only"
          tabIndex={-1}
          value={selected.length ? "answered" : ""}
          required={required}
          readOnly
          aria-label={`${field.label} selection status`}
        />
      </fieldset>
    );
  }

  if (field.type === "rating" || field.type === "scale") {
    const min = field.validation?.min ?? 1;
    const max = field.validation?.max || 5;
    return (
      <div className="space-y-3">
        {label}
        <div className="flex flex-wrap gap-2">
          {Array.from(
            { length: Math.max(1, max - min + 1) },
            (_, index) => min + index,
          ).map((score) => (
            <button
              key={score}
              type="button"
              onClick={() => onChange(score)}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-md border text-[13px] font-medium",
                Number(value) === score && "border-current bg-current/10",
              )}
            >
              {score}
            </button>
          ))}
        </div>
        <input
          className="sr-only"
          tabIndex={-1}
          value={value == null || value === "" ? "" : "answered"}
          required={required}
          readOnly
          aria-label={`${field.label} rating status`}
        />
      </div>
    );
  }

  if (field.type === "ranking") {
    // Hoisted so the already-ranked options are narrowed once and reused,
    // rather than testing the raw union a second time.
    const chosen = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
    const ranked = [
      ...chosen,
      ...options.filter((option) => !chosen.includes(option)),
    ];
    const moveOption = (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= ranked.length) return;
      const next = [...ranked];
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next);
    };
    return (
      <div className="space-y-3">
        {label}
        <div className="divide-y border-y">
          {ranked.map((option, index) => (
            <div
              key={option}
              className="flex min-h-12 items-center gap-3 px-2 text-[13px]"
            >
              <span className="flex h-6 w-6 items-center justify-center border text-[10px] font-semibold">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{option}</span>
              <button
                type="button"
                onClick={() => moveOption(index, -1)}
                disabled={index === 0}
                className="flex h-8 w-8 items-center justify-center opacity-60 hover:opacity-100 disabled:opacity-20"
                aria-label={`Move ${option} up`}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => moveOption(index, 1)}
                disabled={index === ranked.length - 1}
                className="flex h-8 w-8 items-center justify-center opacity-60 hover:opacity-100 disabled:opacity-20"
                aria-label={`Move ${option} down`}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="text-[10px] opacity-55">
          Use the arrows to place the most important option first.
        </p>
      </div>
    );
  }

  if (field.type === "matrix") {
    const rows = field.config?.matrixRows || [];
    const selected = structuredAnswer(value);
    const completed =
      rows.length > 0 &&
      rows.every((row) => options.includes(String(selected[row] || "")));
    return (
      <fieldset className="space-y-3">
        {label}
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[520px] border-collapse text-[12px]">
            <thead className="bg-current/5">
              <tr>
                <th className="px-3 py-2 text-left font-medium" />
                {options.map((option) => (
                  <th key={option} className="px-3 py-2 text-center font-medium">
                    {option}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row} className="border-t">
                  <th className="px-3 py-2 text-left font-medium">{row}</th>
                  {options.map((option) => (
                    <td key={option} className="px-3 py-2 text-center">
                      <input
                        type="radio"
                        name={`${field.id}-${row}`}
                        aria-label={`${row}: ${option}`}
                        checked={selected[row] === option}
                        onChange={() => onChange({ ...selected, [row]: option })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <input
          className="sr-only"
          tabIndex={-1}
          value={completed ? "answered" : ""}
          required={required}
          readOnly
          aria-label={`${field.label} matrix status`}
        />
      </fieldset>
    );
  }

  if (field.type === "file" || field.type === "camera") {
    return (
      <FileResponseField
        field={field}
        onChange={onChange}
        required={required}
        value={value}
      />
    );
  }

  if (field.type === "multipleFiles") {
    return (
      <MultipleFilesResponseField
        field={field}
        onChange={onChange}
        required={required}
        value={value}
      />
    );
  }

  if (field.type === "signature") {
    return (
      <SignatureResponseField
        field={field}
        onChange={onChange}
        required={required}
        value={value}
      />
    );
  }

  if (field.type === "imageChoice") {
    return (
      <fieldset className="space-y-3">
        {label}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={cn(
                "relative aspect-[4/3] overflow-hidden rounded-md border p-3 text-left text-[12px]",
                value === option && "border-current ring-1 ring-current",
              )}
            >
              {field.config?.optionImages?.[option] ? (
                <img
                  src={field.config.optionImages[option]}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <Image className="h-5 w-5 opacity-50" />
              )}
              <span
                className={cn(
                  "absolute inset-x-0 bottom-0 px-3 py-2",
                  field.config?.optionImages?.[option] &&
                    "bg-black/65 text-white",
                )}
              >
                {option}
              </span>
              {value === option && (
                <Check className="absolute right-2 top-2 h-4 w-4" />
              )}
            </button>
          ))}
        </div>
        <input
          className="sr-only"
          tabIndex={-1}
          value={value ? "answered" : ""}
          required={required}
          readOnly
          aria-label={`${field.label} image selection status`}
        />
      </fieldset>
    );
  }

  if (String(field.type) === "product") {
    return (
      <ProductResponseField
        currency={currency}
        field={field}
        required={required}
        value={value}
        onChange={onChange}
      />
    );
  }
  if (field.type === "product") {
    const products = field.config?.catalogProducts || [];
    if (products.length === 0)
      return (
        <ProductResponseField
          currency={currency}
          field={field}
          required={required}
          value={value}
          onChange={onChange}
        />
      );
    const selections = Array.isArray(value)
      ? value.filter(
          (item): item is { productId: string; variantId?: string; quantity: number } =>
            Boolean(item && typeof item === "object" && "productId" in item),
        )
      : [];
    const minimum = 1;
    const configuredMaximum = 1000;
    const updateSelection = (
      productId: string,
      patch: Partial<{ variantId: string; quantity: number }> | null,
    ) => {
      const current = selections.find((selection) => selection.productId === productId);
      let next = selections.filter((selection) => selection.productId !== productId);
      if (patch) {
        const product = products.find((item) => item.id === productId)!;
        const variantId = patch.variantId ?? current?.variantId ?? product.variants[0]?.id;
        const selectedVariant = variantId
          ? product.variants.find((variant) => variant.id === variantId)
          : undefined;
        const available = selectedVariant
          ? selectedVariant.availableQuantity
          : product.availableQuantity;
        const allowBackorder = selectedVariant?.allowBackorder ?? product.allowBackorder;
        const productMinimum = Math.max(minimum, product.minQuantity ?? minimum);
        const productMaximum = Math.min(
          configuredMaximum,
          Math.max(productMinimum, product.maxQuantity ?? configuredMaximum),
        );
        const stockMaximum = available == null || allowBackorder
          ? productMaximum
          : Math.max(0, Math.min(productMaximum, available));
        const quantity = Math.min(
          stockMaximum,
          Math.max(productMinimum, Math.floor(patch.quantity ?? current?.quantity ?? productMinimum)),
        );
        if (quantity > 0) {
          const selection = {
            productId,
            ...(variantId ? { variantId } : {}),
            quantity,
          };
          next = field.config?.allowMultipleProducts === false ? [selection] : [...next, selection];
        }
      }
      onChange(next);
    };
    return (
      <fieldset className="space-y-3">
        {label}
        <div className="grid gap-3 sm:grid-cols-2">
          {products.map((product) => {
            const selected = selections.find((item) => item.productId === product.id);
            const selectedVariant = product.variants.find((variant) => variant.id === selected?.variantId);
            const available = selectedVariant
              ? selectedVariant.availableQuantity
              : product.availableQuantity;
            const backorders = selectedVariant?.allowBackorder ?? product.allowBackorder;
            const soldOut = available === 0 && !backorders;
            const unitPrice = selectedVariant?.price ?? product.price;
            const productImage = product.imageUrl || product.imageGallery?.[0];
            return (
              <article key={product.id} className={cn("overflow-hidden border", selected && "border-current ring-1 ring-current")}>
                {productImage && <img src={productImage} alt="" className="h-32 w-full object-cover" />}
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold">{product.name}</p>
                      {product.description && <p className="mt-1 line-clamp-2 text-[11px] opacity-65">{product.description}</p>}
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">{formatCurrency(unitPrice, product.currency)}</span>
                  </div>
                  {product.variants.length > 0 && (
                    <Select
                      value={selected?.variantId || product.variants[0]?.id}
                      onValueChange={(variantId) => updateSelection(product.id, { variantId, quantity: selected?.quantity || minimum })}
                    >
                      <SelectTrigger aria-label={`${product.name} variation`}>
                        <SelectValue placeholder="Choose a variation" />
                      </SelectTrigger>
                      <SelectContent>
                        {product.variants.map((variant) => (
                          <SelectItem
                            key={variant.id}
                            value={variant.id}
                            disabled={variant.availableQuantity === 0 && !variant.allowBackorder}
                          >
                            {variant.name} · {formatCurrency(variant.price, product.currency)}
                            {variant.availableQuantity != null ? ` · ${variant.availableQuantity} left` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {selected ? (
                    <div className="flex items-center justify-between gap-3">
                      {field.config?.showProductQuantity !== false ? (
                        <div className="flex items-center border">
                          <button type="button" className="flex h-9 w-9 items-center justify-center" aria-label={`Decrease ${product.name} quantity`} onClick={() => selected.quantity <= Math.max(minimum, product.minQuantity ?? minimum) ? updateSelection(product.id, null) : updateSelection(product.id, { quantity: selected.quantity - 1 })}>
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="min-w-9 text-center text-[12px] tabular-nums">{selected.quantity}</span>
                          <button type="button" className="flex h-9 w-9 items-center justify-center" aria-label={`Increase ${product.name} quantity`} disabled={available != null && !backorders && selected.quantity >= available} onClick={() => updateSelection(product.id, { quantity: selected.quantity + 1 })}>
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : <span className="text-[11px] opacity-65">Quantity 1</span>}
                      <button type="button" className="text-[11px] font-medium underline underline-offset-4" onClick={() => updateSelection(product.id, null)}>Remove</button>
                    </div>
                  ) : (
                    <Button type="button" variant="outline" className="w-full bg-transparent" disabled={soldOut} onClick={() => updateSelection(product.id, { quantity: Math.max(minimum, product.minQuantity ?? minimum) })}>
                      <ShoppingCart className="h-4 w-4" />
                      {soldOut ? "Out of stock" : "Add to order"}
                    </Button>
                  )}
                  {available != null && available > 0 && available <= 5 && (
                    <p className="text-[10px] font-medium text-amber-600">Only {available} remaining</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <input
          className="sr-only"
          tabIndex={-1}
          value={selections.length ? "answered" : ""}
          required={required}
          readOnly
          aria-label={`${field.label} product selection status`}
        />
      </fieldset>
    );
  }

  if (field.type === "coupon") {
    return (
      <div className="space-y-2">
        {label}
        <Input
          id={id}
          value={String(value || "")}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter code"
          required={required}
          className="bg-transparent uppercase"
        />
      </div>
    );
  }

  if (field.type === "address") {
    const address = structuredAnswer(value);
    const parts = [
      ["street", "Street address", "sm:col-span-2"],
      ["city", "City", ""],
      ["region", "State / region", ""],
      ["postalCode", "Postal code", ""],
      ["country", "Country", ""],
    ] as const;
    return (
      <fieldset className="space-y-3">
        {label}
        <div className="grid gap-2 sm:grid-cols-2">
          {parts.map(([key, placeholder, className]) => (
            <Input
              key={key}
              id={key === "street" ? id : `${id}-${key}`}
              aria-label={`${field.label} ${placeholder}`}
              placeholder={placeholder}
              value={String(address[key] || "")}
              onChange={(event) =>
                onChange({ ...address, [key]: event.target.value })
              }
              className={cn("bg-transparent", className)}
            />
          ))}
        </div>
        <input
          className="sr-only"
          tabIndex={-1}
          value={address.street && address.city && address.country ? "answered" : ""}
          required={required}
          readOnly
          aria-label={`${field.label} address status`}
        />
      </fieldset>
    );
  }

  if (field.type === "location") {
    const location = structuredAnswer(value);
    const setCoordinate = (key: "latitude" | "longitude", nextValue: string) =>
      onChange({ ...location, [key]: nextValue });
    const complete =
      location.latitude !== "" &&
      location.latitude != null &&
      location.longitude !== "" &&
      location.longitude != null;
    return (
      <fieldset className="space-y-3">
        {label}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            id={id}
            type="number"
            step="any"
            min="-90"
            max="90"
            aria-label={`${field.label} latitude`}
            placeholder="Latitude"
            value={String(location.latitude ?? "")}
            onChange={(event) => setCoordinate("latitude", event.target.value)}
            className="bg-transparent"
          />
          <Input
            id={`${id}-longitude`}
            type="number"
            step="any"
            min="-180"
            max="180"
            aria-label={`${field.label} longitude`}
            placeholder="Longitude"
            value={String(location.longitude ?? "")}
            onChange={(event) => setCoordinate("longitude", event.target.value)}
            className="bg-transparent"
          />
        </div>
        <button
          type="button"
          className="text-[11px] font-medium underline-offset-4 hover:underline"
          onClick={() =>
            navigator.geolocation?.getCurrentPosition((position) =>
              onChange({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              }),
            )
          }
        >
          Use my current location
        </button>
        <input
          className="sr-only"
          tabIndex={-1}
          value={complete ? "answered" : ""}
          required={required}
          readOnly
          aria-label={`${field.label} location status`}
        />
      </fieldset>
    );
  }

  return null;
}

function getSteps(fields: FormField[]) {
  const steps: FormField[][] = [[]];
  fields.forEach((field) => {
    if (field.type === "pageBreak") {
      steps.push([]);
    } else {
      steps[steps.length - 1].push(field);
    }
  });
  return steps.filter((step) => step.length > 0);
}

function initialAnswers(fields: FormField[]) {
  return fields.reduce<Record<string, FormAnswerValue>>((result, field) => {
    if (field.defaultValue != null && field.defaultValue !== "") {
      result[field.id] = field.defaultValue;
    } else if (field.type === "ranking" && field.options?.length) {
      result[field.id] = [...field.options];
    }
    return result;
  }, {});
}

type PersistedResponseDraft = {
  answers: Record<string, FormAnswerValue>;
  step: number;
};

const responseDraftKey = (form: FormRecord) =>
  `maxform:response-draft:${form.id}:${form.settings.version}`;

const isPersistableAnswer = (value: FormAnswerValue) =>
  !(
    (value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "kind" in value &&
      (value.kind === "file" || value.kind === "signature")) ||
    (Array.isArray(value) &&
      value.some(
        (item) => item && typeof item === "object" && "kind" in item,
      ))
  );

const persistableAnswers = (
  answers: Record<string, FormAnswerValue>,
  fields: FormField[],
) =>
  Object.fromEntries(
    Object.entries(answers).filter(([fieldId, value]) =>
      fields.find((field) => field.id === fieldId)?.type !== "password" &&
      isPersistableAnswer(value),
    ),
  ) as Record<string, FormAnswerValue>;

const readResponseDraft = (
  form: FormRecord,
  preview: boolean,
): PersistedResponseDraft | null => {
  if (preview || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(responseDraftKey(form));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedResponseDraft>;
    return {
      answers:
        parsed.answers && typeof parsed.answers === "object"
          ? (parsed.answers as Record<string, FormAnswerValue>)
          : {},
      step: Number.isFinite(parsed.step) ? Number(parsed.step) : 0,
    };
  } catch {
    return null;
  }
};

export function FormRenderer({
  checkoutSummary,
  compact = false,
  form,
  couponsEnabled = form.settings.payment.allowCoupons,
  onSubmit,
  preview = false,
  submitting = false,
}: FormRendererProps) {
  const respondentPrefersDark = useRespondentPrefersDark();
  const renderedFields = useMemo(
    () =>
      form.fields.filter(
        (field) =>
          field.type !== "orderSummary" &&
          (field.type !== "coupon" || couponsEnabled),
      ),
    [couponsEnabled, form.fields],
  );
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>(() =>
    ({
      ...initialAnswers(renderedFields),
      ...(readResponseDraft(form, preview)?.answers || {}),
    }),
  );
  const [step, setStep] = useState(() =>
    Math.max(0, readResponseDraft(form, preview)?.step || 0),
  );
  const formStateKey = `${form.id}:${form.settings.version}:${couponsEnabled}`;
  const loadedFormStateKey = useRef(formStateKey);
  const steps = useMemo(() => getSteps(renderedFields), [renderedFields]);
  const safeStep = Math.min(step, Math.max(steps.length - 1, 0));
  const currentFields = useMemo(
    () => steps[safeStep] || [],
    [safeStep, steps],
  );
  const theme = form.settings.theme;
  const resolvedAnswers = useMemo(() => {
    const resolved = {
      ...initialAnswers(renderedFields),
      ...answers,
    };
    renderedFields.forEach((field) => {
      if (field.type === "calculated") {
        resolved[field.id] = resolveCalculatedAnswer(
          field,
          renderedFields,
          resolved,
        );
      }
    });
    return resolved;
  }, [answers, renderedFields]);
  const currentTicketField = currentFields.find(
    (field) => field.id === "ticket-selection",
  );
  const selectedTicket = ticketAnswer(resolvedAnswers["ticket-selection"]);
  const selectedTicketLimit =
    currentTicketField?.config?.ticketLimits?.[selectedTicket.name];
  const ticketSelectionReady =
    !currentTicketField ||
    Boolean(
      selectedTicket.name &&
        selectedTicketLimit &&
        selectedTicketLimit.remaining >= selectedTicketLimit.min &&
        selectedTicket.quantity >= selectedTicketLimit.min &&
        selectedTicket.quantity <=
        Math.min(selectedTicketLimit.max, selectedTicketLimit.remaining),
    );
  const currentRequiredFieldsReady = useMemo(
    () =>
      currentFields.every((field) => {
        if (nonResponseFieldTypes.has(field.type)) return true;
        if (!isFieldVisible(field.id, form.settings.logic, resolvedAnswers)) {
          return true;
        }
        if (!isFieldRequired(field, form.settings.logic, resolvedAnswers)) {
          return true;
        }
        return requiredAnswerIsComplete(field, resolvedAnswers[field.id]);
      }),
    [currentFields, form.settings.logic, resolvedAnswers],
  );
  const allRequiredFieldsReady = useMemo(
    () =>
      renderedFields.every((field) => {
        if (nonResponseFieldTypes.has(field.type)) return true;
        if (!isFieldVisible(field.id, form.settings.logic, resolvedAnswers)) {
          return true;
        }
        if (!isFieldRequired(field, form.settings.logic, resolvedAnswers)) {
          return true;
        }
        return requiredAnswerIsComplete(field, resolvedAnswers[field.id]);
      }),
    [form.settings.logic, renderedFields, resolvedAnswers],
  );
  const actionReady =
    currentRequiredFieldsReady &&
    ticketSelectionReady &&
    (safeStep < steps.length - 1 || allRequiredFieldsReady);
  const hasPaymentFlow = Boolean(
    checkoutSummary ||
      form.settings.payment.enabled ||
      form.settings.payment.productCommerceEnabled ||
      form.fields.some((field) => field.type === "product"),
  );
  const configuredSubmitButtonLabel =
    form.settings.confirmation.submitButtonLabel?.trim() || "";
  const finalSubmitButtonLabel =
    configuredSubmitButtonLabel ||
    (currentTicketField
      ? "Continue to checkout"
      : hasPaymentFlow
        ? "Continue to payment"
        : "Submit");
  const previewSubmitButtonLabel =
    configuredSubmitButtonLabel ||
    (hasPaymentFlow
      ? currentTicketField
        ? "Continue to checkout"
        : "Continue to payment"
      : "Preview submit");

  useEffect(() => {
    if (loadedFormStateKey.current === formStateKey) return;
    loadedFormStateKey.current = formStateKey;
    const draft = readResponseDraft(form, preview);
    setAnswers({
      ...initialAnswers(renderedFields),
      ...(draft?.answers || {}),
    });
    setStep(Math.min(Math.max(0, draft?.step || 0), Math.max(steps.length - 1, 0)));
  }, [form, formStateKey, preview, renderedFields, steps.length]);

  useEffect(() => {
    if (preview || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        responseDraftKey(form),
        JSON.stringify({
          answers: persistableAnswers(answers, renderedFields),
          step: safeStep,
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // Large browser-only answers, such as file uploads, may exceed storage.
    }
  }, [answers, form, preview, renderedFields, safeStep]);

  useEffect(() => {
    ensureFormFontLoaded(theme.fontFamily);
  }, [theme.fontFamily]);
  const dark =
    theme.respondentMode === "dark" ||
    (theme.respondentMode === "auto" && respondentPrefersDark);
  const accentColor = theme.accentColor || "#2563EB";
  const themeBackground = theme.backgroundColor || "#FFFFFF";
  const themeContainerBackground =
    theme.containerBackgroundColor || themeBackground;
  const themeRadius = theme.radius ?? 6;
  const themeFontSize = theme.fontSize || 16;
  const themeFontWeight = theme.fontWeight || 400;
  const themeLineHeight = theme.lineHeight || 1.5;
  const background =
    dark && themeBackground.toUpperCase() === "#FFFFFF"
      ? "#111214"
      : themeBackground;
  const containerBackground =
    dark &&
    !theme.containerBackgroundColor &&
    themeContainerBackground.toUpperCase() === "#FFFFFF"
      ? background
      : themeContainerBackground;
  const foreground = styleColor(
    theme.textColor,
    dark ? "#F7F7F8" : "#17181A",
  );
  const muted = dark ? "#A3A3A8" : "#666A73";
  const border = styleColor(
    theme.containerBorderColor,
    styleColor(theme.blockStyle?.borderColor,
    dark ? "#303136" : "#E0E2E7"),
  )!;
  const containerBorderWidth = Math.max(
    0,
    theme.containerBorderWidth ?? 1,
  );
  const containerBorderStyle =
    theme.containerBorderStyle ||
    (containerBorderWidth > 0 ? "solid" : "none");
  const containerRadius = Math.max(
    0,
    theme.containerBorderRadius ?? theme.radius ?? 6,
  );
  const borderForControls = styleColor(
    theme.containerBorderColor,
    dark ? "#303136" : "#E0E2E7",
  )!;
  const surface = containerBackground;
  const controlBackground = dark ? "#15161A" : "#FFFFFF";
  const controlForeground = dark ? "#F7F7F8" : "#17181A";
  const controlPlaceholder = dark ? "#8F9198" : "#737780";
  const radius = `${containerRadius}px`;
  const style = {
    ...publicThemeVariables({
      accent: accentColor,
      background: containerBackground,
      border,
      foreground,
      muted,
      radius,
      surface,
    }),
    "--form-accent": accentColor,
    "--form-bg": containerBackground,
    "--form-page-bg": background,
    "--form-fg": foreground,
    "--form-muted": muted,
    "--form-border": border,
    "--form-surface": surface,
    "--form-control-bg": controlBackground,
    "--form-control-fg": controlForeground,
    "--form-control-placeholder": controlPlaceholder,
    "--form-control-border": borderForControls,
    "--form-radius": radius,
    "--form-font-size": `${themeFontSize}px`,
    "--form-font-weight": themeFontWeight,
    "--form-line-height": themeLineHeight,
    backgroundColor: "var(--form-bg)",
    color: "var(--form-fg)",
    fontFamily: `${theme.fontFamily}, sans-serif`,
    fontSize: "var(--form-font-size)",
    fontWeight: "var(--form-font-weight)",
    lineHeight: "var(--form-line-height)",
    letterSpacing: 0,
  } as CSSProperties;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!actionReady || submitting) return;
    if (safeStep < steps.length - 1) {
      setStep((current) => current + 1);
      return;
    }
    onSubmit?.(resolvedAnswers);
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "maxform-renderer mx-auto w-full overflow-hidden border",
        compact
          ? "max-w-[620px]"
          : theme.pageLayout === "full"
            ? "max-w-none"
            : theme.pageLayout === "wide"
              ? "max-w-[920px]"
              : "max-w-[720px]",
      )}
      style={{
        ...style,
        borderColor: "var(--form-border)",
        borderWidth: `${containerBorderWidth}px`,
        borderStyle:
          containerBorderStyle === "none" ? "none" : containerBorderStyle,
        borderRadius: `${containerRadius}px`,
      }}
    >
      {theme.customCss && <style>{theme.customCss}</style>}
      {theme.coverImageUrl && (
        <div
          className="h-40 bg-cover bg-center"
          style={{ backgroundImage: `url("${theme.coverImageUrl}")` }}
        />
      )}
      <div className={cn("px-5 py-6 sm:px-9 sm:py-9", compact && "sm:px-7 sm:py-7")}>
        {theme.logoUrl && (
          <img
            src={theme.logoUrl}
            alt=""
            className="mb-6 h-10 max-w-[160px] object-contain object-left"
          />
        )}
        <div>
          <h1
            className="leading-tight"
            style={{
              fontSize: `${themeFontSize * (compact ? 1.55 : 1.9)}px`,
              fontWeight: Math.max(themeFontWeight, 600),
              letterSpacing: 0,
            }}
          >
            {form.title}
          </h1>
          {form.description && (
            <p
              className="mt-2"
              style={{
                color: "var(--form-muted)",
                fontSize: `${Math.max(12, themeFontSize - 2)}px`,
                lineHeight: themeLineHeight,
              }}
            >
              {form.description}
            </p>
          )}
        </div>

        {steps.length > 1 && (
          <div className="mt-7">
            <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--form-muted)" }}>
              <span>
                Step {safeStep + 1} of {steps.length}
              </span>
              <span>{Math.round(((safeStep + 1) / steps.length) * 100)}%</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--form-border)" }}>
              <div
                className="h-full transition-all"
                style={{
                  backgroundColor: "var(--form-accent)",
                  width: `${((safeStep + 1) / steps.length) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-6">
          {currentFields.map((field) => {
            if (field.type === "hidden") return null;
            if (!isFieldVisible(field.id, form.settings.logic, resolvedAnswers)) return null;
            return (
              <div
                key={field.id}
                className={
                  cn(
                    "maxform-field col-span-2",
                    field.width === "half" && "sm:col-span-1",
                  )
                }
                style={resolveFieldBlockStyle({
                  fieldStyle: field.config?.blockStyle,
                  formRadius: themeRadius,
                  formStyle: theme.blockStyle,
                })}
              >
                <ResponseField
                  currency={form.settings.payment.currency}
                  field={field}
                  required={isFieldRequired(
                    field,
                    form.settings.logic,
                    resolvedAnswers,
                  )}
                  themeMode={dark ? "dark" : "light"}
                  value={resolvedAnswers[field.id]}
                  onChange={(value) =>
                    setAnswers((current) => ({
                      ...current,
                      [field.id]: value,
                    }))
                  }
                />
              </div>
            );
          })}
        </div>

        {safeStep === steps.length - 1 && checkoutSummary && (
          <div
            className="mt-8 flex items-center justify-between gap-5 border-y py-4"
            style={{ borderColor: "var(--form-border)" }}
          >
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--form-muted)" }}>
                {checkoutSummary.label}
              </p>
              <p className="mt-1 text-[11px]" style={{ color: "var(--form-muted)" }}>
                Payment is completed securely after registration.
              </p>
            </div>
            <p className="shrink-0 text-[20px] font-semibold">
              {formatCurrency(checkoutSummary.amount, checkoutSummary.currency)}
            </p>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          {safeStep > 0 ? (
            <button
              type="button"
              onClick={() => setStep((current) => current - 1)}
              disabled={submitting}
              className="inline-flex h-10 items-center gap-2 px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: "var(--form-muted)" }}
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            disabled={submitting || !actionReady}
            loading={safeStep === steps.length - 1 && submitting}
            loadingLabel="Submitting response"
            className={cn(
              "inline-flex h-10 items-center gap-2 px-5 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed",
              theme.buttonStyle === "outline" && "border bg-transparent",
              (submitting || !actionReady) && "opacity-60",
            )}
            style={{
              borderColor: "var(--form-accent)",
              borderRadius: "var(--form-radius)",
              backgroundColor:
                theme.buttonStyle === "outline"
                  ? "transparent"
                  : theme.buttonStyle === "soft"
                    ? `${accentColor}20`
                    : "var(--form-accent)",
              color:
                theme.buttonStyle === "solid" ? "#FFFFFF" : "var(--form-accent)",
            }}
          >
            {!ticketSelectionReady
              ? "Select a ticket to continue"
              : !currentRequiredFieldsReady ||
                  (safeStep === steps.length - 1 && !allRequiredFieldsReady)
                ? "Complete required fields"
              : safeStep < steps.length - 1
              ? "Next"
                : preview
                  ? previewSubmitButtonLabel
                  : finalSubmitButtonLabel}
            {safeStep < steps.length - 1 ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
        </div>

        {preview && (
          <div
            className="mt-5 flex items-center justify-center gap-2 border-t pt-4 text-[10px]"
            style={{
              borderColor: "var(--form-border)",
              color: "var(--form-muted)",
            }}
          >
            <Minus className="h-3 w-3" />
            Preview only. No response will be recorded.
          </div>
        )}
      </div>
    </form>
  );
}

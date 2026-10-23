import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  AlignLeft,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Columns3,
  Copy,
  CreditCard,
  FileImage,
  FileText,
  FormInput,
  Globe2,
  GripVertical,
  Heading,
  History,
  Image,
  ListChecks,
  ListOrdered,
  Loader2,
  MapPin,
  Minus,
  MousePointer2,
  Package,
  PanelRight,
  Pencil,
  Plus,
  Radio,
  Redo2,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  SplitSquareVertical,
  Star,
  Trash2,
  Truck,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";

import { FormRenderer } from "@/components/forms/FormRenderer";
import {
  normalizeProductQuantityLimits,
  type PaymentProduct,
  type PaymentProductInput,
  type PaymentProviderConnection,
} from "@/components/payments/payment-types";
import { ScopedCouponManager } from "@/components/payments/ScopedCouponManager";
import { PricingInput } from "@/components/shared/PricingInput";
import {
  ColorControl,
  EditorSection,
  SpacingControlGroup,
  StyleNumberInput,
} from "@/components/shared/StyleControls";
import { colorInputValue } from "@/components/shared/style-values";
import { PreloaderSettingsEditor } from "@/components/shared/PublicPreloader";
import { ProductGalleryUpload } from "@/components/shared/ProductGalleryUpload";
import { TagInput } from "@/components/shared/TagInput";
import { uploadFileToStorage } from "@/lib/storage";
import { savePaymentProduct } from "@/lib/payments";
import {
  ensureFormFontLoaded,
  FORM_FONT_OPTIONS,
} from "@/components/forms/form-fonts";
import {
  createId,
  type FormBlockStyle,
  type FormField,
  type FormFieldType,
  type FormLogicAction,
  type FormLogicOperator,
  type FormRecord,
  type FormProductDisplayConfig,
  type FormShippingMode,
  type FormShippingRateType,
  type FormShippingRule,
  type FormVersion,
} from "@/components/forms/form-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { scrollDashboardToTop } from "@/lib/dashboard-scroll";
import { currencyOptions, formatCurrency } from "@/lib/regional-options";
import { cn } from "@/lib/utils";

type BuilderMode =
  | "build"
  | "logic"
  | "theme"
  | "preloader"
  | "confirmation"
  | "payment"
  | "contacts"
  | "settings";

export type FormBuilderModeOption = {
  value: BuilderMode;
  label: string;
};

const defaultBuilderModes: FormBuilderModeOption[] = [
  { value: "build", label: "Build" },
  { value: "logic", label: "Logic" },
  { value: "theme", label: "Theme" },
  { value: "preloader", label: "Preloader" },
  { value: "confirmation", label: "Confirmation" },
  { value: "payment", label: "Payment" },
  { value: "contacts", label: "Contacts" },
];

const builderModeKey = (formId: string) =>
  `maxform:form-builder-mode:${formId}`;

const builderFieldKey = (formId: string) =>
  `maxform:form-builder-field:${formId}`;

const readBuilderMode = (formId: string): BuilderMode => {
  try {
    const value = sessionStorage.getItem(builderModeKey(formId));
    return [
      "build",
      "logic",
      "theme",
      "preloader",
      "confirmation",
      "payment",
      "contacts",
      "settings",
    ].includes(value || "")
      ? (value as BuilderMode)
      : "build";
  } catch {
    return "build";
  }
};

const readBuilderField = (form: FormRecord) => {
  try {
    const fieldId = sessionStorage.getItem(builderFieldKey(form.id));
    return form.fields.some((field) => field.id === fieldId)
      ? fieldId
      : form.fields[0]?.id || null;
  } catch {
    return form.fields[0]?.id || null;
  }
};

const cleanBlockStyle = (style: FormBlockStyle): FormBlockStyle => {
  const next = { ...style };
  (Object.keys(next) as (keyof FormBlockStyle)[]).forEach((key) => {
    const value = next[key];
    if (
      value == null ||
      value === "" ||
      (typeof value === "number" && Number.isNaN(value))
    ) {
      delete next[key];
    }
  });
  return next;
};

const cloneFormRecord = (value: FormRecord): FormRecord => {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as FormRecord;
  }
};

const blockNumber = (
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
  themeSide: number | undefined,
  themeAll: number | undefined,
) => blockNumber(fallback, fieldSide, fieldAll, themeSide, themeAll);

const resolveBuilderBlockStyle = (
  fieldStyle: FormBlockStyle | undefined,
  themeStyle: FormBlockStyle | undefined,
) => {
  const borderColor =
    fieldStyle?.borderColor?.trim() ||
    themeStyle?.borderColor?.trim() ||
    "hsl(var(--border))";
  const borderWidth = blockNumber(
    0,
    fieldStyle?.borderWidth,
    themeStyle?.borderWidth,
  );
  const borderRadius = blockNumber(
    6,
    fieldStyle?.borderRadius,
    themeStyle?.borderRadius,
  );
  const fieldTextColor =
    fieldStyle?.textColor || themeStyle?.textColor || undefined;
  const fieldFontFamily =
    fieldStyle?.fontFamily || themeStyle?.fontFamily || undefined;
  const fieldLineHeight =
    fieldStyle?.lineHeight ?? themeStyle?.lineHeight ?? undefined;
  const inputBackground =
    fieldStyle?.inputBackgroundColor ||
    fieldStyle?.backgroundColor ||
    themeStyle?.inputBackgroundColor ||
    themeStyle?.backgroundColor ||
    undefined;
  const inputText =
    fieldStyle?.inputTextColor ||
    fieldTextColor ||
    themeStyle?.inputTextColor ||
    undefined;
  const inputBorder =
    fieldStyle?.inputBorderColor ||
    fieldStyle?.borderColor ||
    themeStyle?.inputBorderColor ||
    borderColor;
  const inputBorderWidth = blockNumber(
    1,
    fieldStyle?.inputBorderWidth,
    themeStyle?.inputBorderWidth,
  );
  const inputBorderRadius = blockNumber(
    borderRadius,
    fieldStyle?.inputBorderRadius,
    themeStyle?.inputBorderRadius,
  );
  const fieldBorderStyle =
    fieldStyle?.borderStyle ||
    themeStyle?.borderStyle ||
    (borderWidth > 0 ? "solid" : "none");
  const inputBorderStyle =
    fieldStyle?.inputBorderStyle ||
    themeStyle?.inputBorderStyle ||
    "solid";

  return {
    backgroundColor:
      fieldStyle?.backgroundColor?.trim() ||
      themeStyle?.backgroundColor?.trim() ||
      undefined,
    borderColor,
    borderRadius,
    borderStyle: fieldBorderStyle === "none" ? undefined : fieldBorderStyle,
    borderWidth,
    color: fieldTextColor,
    fontFamily: fieldFontFamily,
    fontSize: fieldStyle?.fontSize ?? themeStyle?.fontSize,
    fontWeight: fieldStyle?.fontWeight ?? themeStyle?.fontWeight,
    lineHeight: fieldLineHeight,
    "--form-field-text": fieldTextColor,
    "--form-field-label": fieldStyle?.labelColor || fieldTextColor,
    "--form-field-help": fieldStyle?.helpTextColor || undefined,
    "--form-field-placeholder": fieldStyle?.placeholderColor || undefined,
    "--form-field-input-bg": inputBackground,
    "--form-field-input-text": inputText,
    "--form-field-input-border": inputBorder,
    "--form-field-input-border-width": `${inputBorderWidth}px`,
    "--form-field-input-border-style": inputBorderStyle,
    "--form-field-input-radius": `${inputBorderRadius}px`,
    "--form-field-font-size": fieldStyle?.fontSize
      ? `${fieldStyle.fontSize}px`
      : themeStyle?.fontSize
        ? `${themeStyle.fontSize}px`
        : undefined,
    "--form-field-font-weight": fieldStyle?.fontWeight
      ? String(fieldStyle.fontWeight)
      : themeStyle?.fontWeight
        ? String(themeStyle.fontWeight)
        : undefined,
    "--form-field-font-family": fieldFontFamily,
    "--form-field-line-height": fieldLineHeight
      ? String(fieldLineHeight)
      : undefined,
    paddingTop:
      blockSideValue(
        0,
        fieldStyle?.paddingTop,
        fieldStyle?.padding,
        themeStyle?.paddingTop,
        themeStyle?.padding,
      ) || undefined,
    paddingRight:
      blockSideValue(
        0,
        fieldStyle?.paddingRight,
        fieldStyle?.padding,
        themeStyle?.paddingRight,
        themeStyle?.padding,
      ) || undefined,
    paddingBottom:
      blockSideValue(
        0,
        fieldStyle?.paddingBottom,
        fieldStyle?.padding,
        themeStyle?.paddingBottom,
        themeStyle?.padding,
      ) || undefined,
    paddingLeft:
      blockSideValue(
        0,
        fieldStyle?.paddingLeft,
        fieldStyle?.padding,
        themeStyle?.paddingLeft,
        themeStyle?.padding,
      ) || undefined,
  } as CSSProperties;
};

const resolveBuilderBlockMargin = (
  fieldStyle: FormBlockStyle | undefined,
  themeStyle: FormBlockStyle | undefined,
) =>
  ({
    marginTop:
      blockSideValue(
        0,
        fieldStyle?.marginTop,
        fieldStyle?.margin,
        themeStyle?.marginTop,
        themeStyle?.margin,
      ) || undefined,
    marginRight:
      blockSideValue(
        0,
        fieldStyle?.marginRight,
        fieldStyle?.margin,
        themeStyle?.marginRight,
        themeStyle?.margin,
      ) || undefined,
    marginBottom:
      blockSideValue(
        0,
        fieldStyle?.marginBottom,
        fieldStyle?.margin,
        themeStyle?.marginBottom,
        themeStyle?.margin,
      ) || undefined,
    marginLeft:
      blockSideValue(
        0,
        fieldStyle?.marginLeft,
        fieldStyle?.margin,
        themeStyle?.marginLeft,
        themeStyle?.margin,
      ) || undefined,
  }) as CSSProperties;

const spacingPatch = (
  kind: "padding" | "margin",
  side: "Top" | "Right" | "Bottom" | "Left",
  value: number | undefined,
) => ({ [`${kind}${side}`]: value }) as FormBlockStyle;

type FieldCatalogItem = {
  type: FormFieldType;
  label: string;
  icon: typeof Type;
  group: string;
};

const fieldCatalog: FieldCatalogItem[] = [
  { type: "shortText", label: "Short text", icon: FormInput, group: "Text" },
  { type: "longText", label: "Long text", icon: AlignLeft, group: "Text" },
  { type: "email", label: "Email", icon: FormInput, group: "Text" },
  { type: "phone", label: "Phone", icon: FormInput, group: "Text" },
  { type: "number", label: "Number", icon: FormInput, group: "Text" },
  { type: "url", label: "URL", icon: FormInput, group: "Text" },
  { type: "password", label: "Password", icon: FormInput, group: "Text" },
  { type: "dropdown", label: "Dropdown", icon: ChevronDown, group: "Choice" },
  { type: "multiSelect", label: "Multi-select", icon: ListChecks, group: "Choice" },
  { type: "radio", label: "Radio", icon: Radio, group: "Choice" },
  { type: "checkboxes", label: "Checkboxes", icon: CheckSquare, group: "Choice" },
  { type: "yesNo", label: "Yes / No", icon: SlidersHorizontal, group: "Choice" },
  { type: "rating", label: "Rating", icon: Star, group: "Choice" },
  { type: "scale", label: "Scale", icon: SlidersHorizontal, group: "Choice" },
  { type: "ranking", label: "Ranking", icon: ListOrdered, group: "Choice" },
  { type: "matrix", label: "Matrix", icon: Columns3, group: "Choice" },
  { type: "date", label: "Date", icon: CalendarDays, group: "Date & time" },
  { type: "time", label: "Time", icon: Clock3, group: "Date & time" },
  { type: "dateRange", label: "Date range", icon: CalendarDays, group: "Date & time" },
  { type: "appointment", label: "Appointment", icon: CalendarDays, group: "Date & time" },
  { type: "file", label: "File upload", icon: Upload, group: "Media" },
  { type: "multipleFiles", label: "Multiple files", icon: Upload, group: "Media" },
  { type: "imageChoice", label: "Image choice", icon: FileImage, group: "Media" },
  { type: "signature", label: "Signature", icon: MousePointer2, group: "Media" },
  { type: "camera", label: "Camera", icon: Image, group: "Media" },
  { type: "section", label: "Section", icon: Columns3, group: "Structure" },
  { type: "pageBreak", label: "Page break", icon: SplitSquareVertical, group: "Structure" },
  { type: "heading", label: "Heading", icon: Heading, group: "Structure" },
  { type: "divider", label: "Divider", icon: Minus, group: "Structure" },
  { type: "html", label: "HTML content", icon: FileText, group: "Structure" },
  { type: "address", label: "Address", icon: FormInput, group: "Identity" },
  { type: "location", label: "GPS location", icon: SlidersHorizontal, group: "Identity" },
  { type: "product", label: "Products", icon: ListChecks, group: "Commerce" },
  { type: "hidden", label: "Hidden field", icon: FileText, group: "Identity" },
  { type: "calculated", label: "Calculated", icon: Settings2, group: "Identity" },
];

const fieldGroups = Array.from(new Set(fieldCatalog.map((item) => item.group)));

const fieldLabel = (type: FormFieldType) =>
  fieldCatalog.find((item) => item.type === type)?.label || "Field";

const createField = (type: FormFieldType): FormField => {
  const choices = [
    "dropdown",
    "multiSelect",
    "radio",
    "checkboxes",
    "ranking",
    "imageChoice",
    "appointment",
    "matrix",
  ].includes(type);
  const options = choices
    ? type === "appointment"
      ? ["09:00", "10:30", "13:00", "15:30"]
      : ["Option 1", "Option 2", "Option 3"]
    : undefined;
  return {
    id: createId("field"),
    type,
    label:
      type === "pageBreak"
        ? "New step"
        : type === "divider"
          ? "Divider"
          : type === "html"
            ? "Formatted content"
          : fieldLabel(type),
    placeholder: ["shortText", "longText", "email", "phone", "number", "url", "password"].includes(type)
      ? `Enter ${fieldLabel(type).toLowerCase()}`
      : undefined,
    options,
    required: false,
    width: "full",
    config:
      type === "file" || type === "multipleFiles" || type === "camera"
        ? {
            acceptedFileTypes: type === "camera" ? "images" : "any",
            maxFileSizeMb: 5,
            ...(type === "multipleFiles" ? { maxFiles: 5 } : {}),
          }
        : type === "matrix"
          ? { matrixRows: ["Row 1", "Row 2", "Row 3"] }
        : type === "signature"
          ? {
              signatureBackgroundColor: "#FFFFFF",
              signaturePenColor: "#111827",
            }
          : type === "product"
            ? {
                productIds: [],
                catalogProducts: [],
                allowMultipleProducts: true,
                showProductQuantity: true,
                productCouponsEnabled: false,
                productDisplay: {
                  style: "cards",
                  columns: 2,
                  imageSize: "medium",
                  imageAspectRatio: "square",
                  cardBackground: "#FFFFFF",
                  cardBorderColor: "#E5E7EB",
                  cardBorderRadius: 12,
                  cardPadding: 12,
                  cardSpacing: 12,
                  imageAlignment: "left",
                  textAlignment: "left",
                  selectionStyle: "button",
                  showOrderSummary: true,
                  hideSoldOutProducts: true,
                },
              }
            : undefined,
  };
};

function FieldPalette({
  onAdd,
}: {
  onAdd: (type: FormFieldType) => void;
}) {
  return (
    <div className="min-w-0 max-w-full overflow-x-hidden">
      {fieldGroups.map((group) => (
        <div key={group} className="mb-6 last:mb-0">
          <p className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">
            {group}
          </p>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
            {fieldCatalog
              .filter((item) => item.group === group)
              .map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(
                        "application/x-maxform-field-type",
                        item.type,
                      );
                    }}
                    onClick={() => onAdd(item.type)}
                    className="flex min-h-9 items-center gap-2 rounded-md border border-transparent px-2 text-left text-[12px] text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldProperties({
  defaultFontFamily = "Inter",
  field,
  onChange,
  onApplyToAll,
  onCreateProduct,
  onEditProduct,
  paymentProducts = [],
}: {
  defaultFontFamily?: string;
  field: FormField | null;
  onChange: (field: FormField) => void;
  onApplyToAll?: () => void | Promise<void>;
  onCreateProduct?: () => void;
  onEditProduct?: (product: PaymentProduct) => void;
  paymentProducts?: PaymentProduct[];
}) {
  const [mediaError, setMediaError] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [applyingToAll, setApplyingToAll] = useState(false);

  const applyToAll = async () => {
    if (!onApplyToAll || applyingToAll) return;
    setApplyingToAll(true);
    try {
      await onApplyToAll();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
    } finally {
      setApplyingToAll(false);
    }
  };

  useEffect(() => {
    setMediaError("");
  }, [field?.id]);

  if (!field) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center px-5 text-center">
        <PanelRight className="h-5 w-5 text-muted-foreground" />
        <p className="mt-3 text-[13px] font-medium">Select a field</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Its label, validation, options, and layout will appear here.
        </p>
      </div>
    );
  }

  const set = <K extends keyof FormField>(key: K, value: FormField[K]) =>
    onChange({ ...field, [key]: value });
  const setConfig = (
    patch: Partial<NonNullable<FormField["config"]>>,
  ) => onChange({ ...field, config: { ...field.config, ...patch } });
  const setBlockStyle = (patch: FormBlockStyle) =>
    setConfig({
      blockStyle: cleanBlockStyle({
        ...(field.config?.blockStyle || {}),
        ...patch,
      }),
    });
  const catalogItem = fieldCatalog.find((item) => item.type === field.type);
  const FieldIcon = catalogItem?.icon || FormInput;

  const hasPlaceholder = [
    "shortText",
    "longText",
    "email",
    "phone",
    "number",
    "url",
    "password",
  ].includes(field.type);
  const hasOptions = [
    "dropdown",
    "multiSelect",
    "radio",
    "checkboxes",
    "ranking",
    "imageChoice",
    "appointment",
    "matrix",
  ].includes(field.type);
  const structural = ["divider", "pageBreak", "heading", "section", "html", "orderSummary"].includes(field.type);
  const blockStyle = field.config?.blockStyle || {};

  const productSnapshot = toFormCatalogProduct;
  const selectedProductItems = paymentProducts.filter((product) =>
    (field.config?.productIds || []).includes(product.id),
  );
  const toggleCatalogProduct = (product: PaymentProduct) => {
    const ids = field.config?.productIds || [];
    const selected = ids.includes(product.id);
    const productIds = selected
      ? ids.filter((id) => id !== product.id)
      : [...ids, product.id];
    const selectedProducts = paymentProducts.filter((item) =>
      productIds.includes(item.id),
    );
    setConfig({
      productIds,
      catalogProducts: selectedProducts.map(productSnapshot),
    });
  };

  const updateOption = (index: number, nextOption: string) => {
    const previousOption = field.options?.[index] || "";
    const nextOptions = (field.options || []).map((option, optionIndex) =>
      optionIndex === index ? nextOption : option,
    );
    const optionImages = { ...(field.config?.optionImages || {}) };
    const optionPrices = { ...(field.config?.optionPrices || {}) };
    if (previousOption !== nextOption) {
      if (optionImages[previousOption]) {
        optionImages[nextOption] = optionImages[previousOption];
        delete optionImages[previousOption];
      }
      if (optionPrices[previousOption] != null) {
        optionPrices[nextOption] = optionPrices[previousOption];
        delete optionPrices[previousOption];
      }
    }
    onChange({
      ...field,
      options: nextOptions,
      config: { ...field.config, optionImages, optionPrices },
    });
  };

  const uploadOptionImage = (
    event: ChangeEvent<HTMLInputElement>,
    option: string,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      setMediaError("Choose a JPG, PNG, or WebP image smaller than 2 MB.");
      return;
    }
    void uploadFileToStorage(file, {
      purpose: "form_asset",
      visibility: "public",
    })
      .then((stored) => {
        if (!stored.url) throw new Error("The public image URL is unavailable.");
        setMediaError("");
        setConfig({
          optionImages: {
            ...(field.config?.optionImages || {}),
            [option]: stored.url,
          },
        });
      })
      .catch((error) =>
        setMediaError(
          error instanceof Error
            ? error.message
            : "That image could not be uploaded.",
        ),
      );
  };

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden">
      <header className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FieldIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{field.label}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {catalogItem?.label || "Field"} - {field.width === "half" ? "Half width" : "Full width"}
          </p>
        </div>
      </header>

      <EditorSection
        title="Content"
        description="What respondents see when they reach this field."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="field-label">Label</Label>
            <Input
              id="field-label"
              value={field.label}
              onChange={(event) => set("label", event.target.value)}
              disabled={field.type === "divider"}
            />
          </div>
          {!structural && (
            <div className="space-y-2">
              <Label htmlFor="field-help">Help text</Label>
              <Textarea
                id="field-help"
                value={field.helpText || ""}
                onChange={(event) => set("helpText", event.target.value)}
                className="min-h-[76px]"
              />
            </div>
          )}
          {hasPlaceholder && (
            <div className="space-y-2">
              <Label htmlFor="field-placeholder">Placeholder</Label>
              <Input
                id="field-placeholder"
                value={field.placeholder || ""}
                onChange={(event) => set("placeholder", event.target.value)}
              />
            </div>
          )}
          {field.type === "html" && (
            <div className="space-y-2">
              <Label htmlFor="field-html-content">HTML content</Label>
              <Textarea
                id="field-html-content"
                value={field.defaultValue || ""}
                onChange={(event) => set("defaultValue", event.target.value)}
                placeholder="<p>Add formatted instructions, links, or supporting content.</p>"
                className="min-h-[150px] font-mono text-[12px]"
              />
              <p className="text-[10px] leading-4 text-muted-foreground">
                Unsafe tags, event handlers, and untrusted links are removed on the public form.
              </p>
            </div>
          )}
        </div>
      </EditorSection>

      <EditorSection
        title="Block style"
        description="Style this field independently. Apply the current style to every field when you want a consistent form."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void applyToAll()}
            disabled={!onApplyToAll || applyingToAll}
            loading={applyingToAll}
            loadingLabel="Applying"
            aria-label={
              applyingToAll ? "Applying" : "Apply to all fields"
            }
            className="max-w-full"
          >
            <Copy className="h-3.5 w-3.5" />
            Apply to all fields
          </Button>
        }
      >
        <div className="space-y-5">
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Field content
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorControl
                id={`field-${field.id}-label-color`}
                label="Label color"
                value={blockStyle.labelColor}
                fallback="#17181A"
                onChange={(labelColor) => setBlockStyle({ labelColor })}
              />
              <ColorControl
                id={`field-${field.id}-help-color`}
                label="Help text color"
                value={blockStyle.helpTextColor}
                fallback="#666A73"
                onChange={(helpTextColor) => setBlockStyle({ helpTextColor })}
              />
              <ColorControl
                id={`field-${field.id}-text-color`}
                label="Field text color"
                value={blockStyle.textColor}
                fallback="#17181A"
                onChange={(textColor) => setBlockStyle({ textColor })}
              />
              <ColorControl
                id={`field-${field.id}-placeholder-color`}
                label="Placeholder color"
                value={blockStyle.placeholderColor}
                fallback="#737780"
                onChange={(placeholderColor) =>
                  setBlockStyle({ placeholderColor })
                }
              />
            </div>
          </div>

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Field typography
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <StyleNumberInput
                id={`field-${field.id}-font-size`}
                label="Font size"
                value={blockStyle.fontSize}
                placeholder="Inherit"
                min={10}
                max={32}
                onChange={(fontSize) => setBlockStyle({ fontSize })}
              />
              <div className="space-y-2">
                <Label htmlFor={`field-${field.id}-font-weight`}>
                  Font weight
                </Label>
                <Select
                  value={String(blockStyle.fontWeight || "inherit")}
                  onValueChange={(fontWeight) =>
                    setBlockStyle({
                      fontWeight:
                        fontWeight === "inherit"
                          ? undefined
                          : (Number(fontWeight) as FormBlockStyle["fontWeight"]),
                    })
                  }
                >
                  <SelectTrigger id={`field-${field.id}-font-weight`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Inherit</SelectItem>
                    <SelectItem value="300">Light</SelectItem>
                    <SelectItem value="400">Regular</SelectItem>
                    <SelectItem value="500">Medium</SelectItem>
                    <SelectItem value="600">Semibold</SelectItem>
                    <SelectItem value="700">Bold</SelectItem>
                    <SelectItem value="800">Extra bold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <FontPicker
                value={blockStyle.fontFamily || defaultFontFamily}
                onChange={(fontFamily) => setBlockStyle({ fontFamily })}
              />
              <StyleNumberInput
                id={`field-${field.id}-line-height`}
                label="Line height"
                value={blockStyle.lineHeight}
                placeholder="Inherit"
                min={1}
                max={2.5}
                step={0.1}
                unit=""
                onChange={(lineHeight) => setBlockStyle({ lineHeight })}
              />
            </div>
          </div>

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Input appearance
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorControl
                id={`field-${field.id}-input-background-color`}
                label="Input background"
                value={blockStyle.inputBackgroundColor}
                fallback="#FFFFFF"
                onChange={(inputBackgroundColor) =>
                  setBlockStyle({ inputBackgroundColor })
                }
              />
              <ColorControl
                id={`field-${field.id}-input-text-color`}
                label="Input text color"
                value={blockStyle.inputTextColor}
                fallback="#17181A"
                onChange={(inputTextColor) =>
                  setBlockStyle({ inputTextColor })
                }
              />
              <ColorControl
                id={`field-${field.id}-input-border-color`}
                label="Input border color"
                value={blockStyle.inputBorderColor}
                fallback="#E0E2E7"
                onChange={(inputBorderColor) =>
                  setBlockStyle({ inputBorderColor })
                }
              />
              <StyleNumberInput
                id={`field-${field.id}-input-border-width`}
                label="Input border width"
                value={blockStyle.inputBorderWidth}
                placeholder="1"
                max={12}
                onChange={(inputBorderWidth) =>
                  setBlockStyle({ inputBorderWidth })
                }
              />
              <StyleNumberInput
                id={`field-${field.id}-input-border-radius`}
                label="Input radius"
                value={blockStyle.inputBorderRadius}
                placeholder="Inherit"
                max={48}
                onChange={(inputBorderRadius) =>
                  setBlockStyle({ inputBorderRadius })
                }
              />
              <div className="space-y-2">
                <Label htmlFor={`field-${field.id}-input-border-style`}>
                  Input border style
                </Label>
                <Select
                  value={blockStyle.inputBorderStyle || "solid"}
                  onValueChange={(inputBorderStyle: FormBlockStyle["inputBorderStyle"]) =>
                    setBlockStyle({ inputBorderStyle })
                  }
                >
                  <SelectTrigger id={`field-${field.id}-input-border-style`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solid">Solid</SelectItem>
                    <SelectItem value="dashed">Dashed</SelectItem>
                    <SelectItem value="dotted">Dotted</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Field container
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
            <ColorControl
              id={`field-${field.id}-block-background-color`}
              label="Block background"
              value={blockStyle.backgroundColor}
              fallback="#FFFFFF"
              onChange={(backgroundColor) =>
                setBlockStyle({ backgroundColor })
              }
            />
            <ColorControl
              id={`field-${field.id}-block-border-color`}
              label="Block border color"
              value={blockStyle.borderColor}
              fallback="#E0E2E7"
              onChange={(borderColor) => setBlockStyle({ borderColor })}
            />
            <StyleNumberInput
              id={`field-${field.id}-block-border-width`}
              label="Block border width"
              value={blockStyle.borderWidth}
              placeholder="Inherit"
              max={12}
              onChange={(borderWidth) => setBlockStyle({ borderWidth })}
            />
            <StyleNumberInput
              id={`field-${field.id}-block-border-radius`}
              label="Block radius"
              value={blockStyle.borderRadius}
              placeholder="Inherit"
              max={48}
              onChange={(borderRadius) => setBlockStyle({ borderRadius })}
            />
            <div className="space-y-2">
              <Label htmlFor={`field-${field.id}-block-border-style`}>
                Block border style
              </Label>
              <Select
                value={blockStyle.borderStyle || "solid"}
                onValueChange={(borderStyle: FormBlockStyle["borderStyle"]) =>
                  setBlockStyle({ borderStyle })
                }
              >
                <SelectTrigger id={`field-${field.id}-block-border-style`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="solid">Solid</SelectItem>
                  <SelectItem value="dashed">Dashed</SelectItem>
                  <SelectItem value="dotted">Dotted</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          </div>

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Spacing
            </p>
            <div className="space-y-4">
            <SpacingControlGroup
              baseId={`field-${field.id}-padding`}
              label="Padding"
              placeholder="Inherit"
              values={{
                top: blockStyle.paddingTop ?? blockStyle.padding,
                right: blockStyle.paddingRight ?? blockStyle.padding,
                bottom: blockStyle.paddingBottom ?? blockStyle.padding,
                left: blockStyle.paddingLeft ?? blockStyle.padding,
              }}
              onChange={(side, value) =>
                setBlockStyle(spacingPatch("padding", side, value))
              }
            />
            <SpacingControlGroup
              baseId={`field-${field.id}-margin`}
              label="Margin"
              placeholder="Inherit"
              values={{
                top: blockStyle.marginTop ?? blockStyle.margin,
                right: blockStyle.marginRight ?? blockStyle.margin,
                bottom: blockStyle.marginBottom ?? blockStyle.margin,
                left: blockStyle.marginLeft ?? blockStyle.margin,
              }}
              onChange={(side, value) =>
                setBlockStyle(spacingPatch("margin", side, value))
              }
            />
            </div>
          </div>
        </div>
      </EditorSection>

      {hasOptions && (
        <EditorSection
          title={
            field.type === "appointment"
              ? "Available times"
              : field.type === "matrix"
                ? "Columns"
                : "Options"
          }
          description={
            field.type === "product"
              ? "Set the choices and optional prices shown to respondents."
              : field.type === "imageChoice"
                ? "Add a label and optional image for every choice."
                : "Edit the choices respondents can select."
          }
        >
          <div className="space-y-3">
            {(field.options || []).map((option, index) => (
              <div
                key={`${field.id}-${index}`}
                className="border-b border-border pb-3 last:border-b-0 last:pb-0"
              >
                <div className="flex min-w-0 gap-2">
                  <Input
                    className="min-w-0 flex-1"
                    value={option}
                    type={field.type === "appointment" ? "time" : "text"}
                    aria-label={`Option ${index + 1}`}
                    onChange={(event) => updateOption(index, event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => {
                      const optionImages = {
                        ...(field.config?.optionImages || {}),
                      };
                      const optionPrices = {
                        ...(field.config?.optionPrices || {}),
                      };
                      delete optionImages[option];
                      delete optionPrices[option];
                      onChange({
                        ...field,
                        options: (field.options || []).filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                        config: {
                          ...field.config,
                          optionImages,
                          optionPrices,
                        },
                      });
                    }}
                    aria-label={`Remove option ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {field.type === "product" && (
                  <div className="mt-2 space-y-1.5">
                    <Label htmlFor={`product-price-${index}`}>
                      Price
                    </Label>
                    <Input
                      id={`product-price-${index}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={field.config?.optionPrices?.[option] ?? ""}
                      placeholder="0.00"
                      onChange={(event) => {
                        const optionPrices = {
                          ...(field.config?.optionPrices || {}),
                        };
                        if (event.target.value === "") {
                          delete optionPrices[option];
                        } else {
                          optionPrices[option] = Number(event.target.value);
                        }
                        setConfig({ optionPrices });
                      }}
                    />
                  </div>
                )}
                {field.type === "imageChoice" && (
                  <div className="mt-2 flex items-center gap-3">
                    {field.config?.optionImages?.[option] ? (
                      <img
                        src={field.config.optionImages[option]}
                        alt=""
                        className="h-12 w-16 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-16 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                        <Image className="h-4 w-4" />
                      </span>
                    )}
                    <label
                      htmlFor={`option-image-${field.id}-${index}`}
                      className="cursor-pointer text-[11px] font-medium text-primary hover:underline"
                    >
                      {field.config?.optionImages?.[option]
                        ? "Replace image"
                        : "Upload image"}
                    </label>
                    {field.config?.optionImages?.[option] && (
                      <button
                        type="button"
                        onClick={() => {
                          const optionImages = {
                            ...(field.config?.optionImages || {}),
                          };
                          delete optionImages[option];
                          setConfig({ optionImages });
                        }}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Remove
                      </button>
                    )}
                    <input
                      id={`option-image-${field.id}-${index}`}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(event) => uploadOptionImage(event, option)}
                    />
                  </div>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                set("options", [
                  ...(field.options || []),
                  `Option ${(field.options?.length || 0) + 1}`,
                ])
              }
              className="w-full"
            >
              <Plus className="h-4 w-4" />
              Add option
            </Button>
            {mediaError && (
              <p className="text-[11px] text-destructive" role="alert">
                {mediaError}
              </p>
            )}
            {field.type === "matrix" && (
              <div className="space-y-3 border-t border-border pt-4">
                <Label>Rows</Label>
                {(field.config?.matrixRows || []).map((row, rowIndex) => (
                  <div key={`${field.id}-row-${rowIndex}`} className="flex gap-2">
                    <Input
                      value={row}
                      aria-label={`Matrix row ${rowIndex + 1}`}
                      onChange={(event) => {
                        const matrixRows = [...(field.config?.matrixRows || [])];
                        matrixRows[rowIndex] = event.target.value;
                        setConfig({ matrixRows });
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove matrix row ${rowIndex + 1}`}
                      onClick={() =>
                        setConfig({
                          matrixRows: (field.config?.matrixRows || []).filter(
                            (_, index) => index !== rowIndex,
                          ),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    setConfig({
                      matrixRows: [
                        ...(field.config?.matrixRows || []),
                        `Row ${(field.config?.matrixRows?.length || 0) + 1}`,
                      ],
                    })
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add row
                </Button>
              </div>
            )}
          </div>
        </EditorSection>
      )}

      {field.type === "product" && (
        <EditorSection
          title="Products and cart"
          description="Choose catalog products, variants, and quantity rules for this form."
        >
          <div className="space-y-4">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium">Products in this block</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Only products selected for this form appear in the live block.
                </p>
              </div>
              <div className="grid w-full min-w-0 gap-2">
                <Button type="button" variant="outline" size="sm" className="w-full min-w-0 whitespace-normal" onClick={() => setCatalogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Add from catalog
                </Button>
                {onCreateProduct && (
                  <Button type="button" variant="outline" size="sm" className="w-full min-w-0 whitespace-normal" onClick={onCreateProduct}>
                    <Plus className="h-4 w-4" />
                    New product
                  </Button>
                )}
              </div>
            </div>
            {selectedProductItems.length ? (
              <div className="space-y-2">
                {selectedProductItems.map((product) => (
                  <article
                    key={product.id}
                    className="overflow-hidden rounded-lg border border-primary/40 bg-primary/5"
                  >
                    <div className="flex min-w-0 flex-wrap gap-3 p-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted">
                    {product.imageUrl || product.imageGallery?.[0] ? (
                      <img src={product.imageUrl || product.imageGallery?.[0]} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-[9px] text-muted-foreground">No image</span>
                    )}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block line-clamp-2 break-words text-[12px] font-medium leading-snug">{product.name}</span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        {product.salePrice != null && product.salePrice < product.price
                          ? `${formatCurrency(product.salePrice, product.currency)} sale · ${formatCurrency(product.price, product.currency)} regular`
                          : formatCurrency(product.price, product.currency)}
                        {product.variants.length ? ` · ${product.variants.length} variants` : ""}
                      </span>
                    </span>
                    <div className="basis-full flex flex-wrap items-center justify-end gap-2 border-t border-primary/20 pt-2">
                      {onEditProduct && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-2.5"
                          onClick={() => onEditProduct(product)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2.5 text-muted-foreground hover:text-destructive"
                        onClick={() => toggleCatalogProduct(product)}
                      >
                        Remove
                      </Button>
                    </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-border p-5 text-center text-[11px] text-muted-foreground">
                No products have been added to this block yet.
              </div>
            )}
            {/*
            {paymentProducts.length ? (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {paymentProducts
                  .filter((product) => product.billingType === "one_time")
                  .map((product) => {
                    const selected = (field.config?.productIds || []).includes(product.id);
                    const available = product.trackInventory
                      ? product.inventoryQuantity
                      : null;
                    return (
                      <label
                        key={product.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 border p-3",
                          selected ? "border-primary bg-primary/5" : "border-border",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selected}
                          onChange={() => {
                            const ids = field.config?.productIds || [];
                            const productIds = selected
                              ? ids.filter((id) => id !== product.id)
                              : [...ids, product.id];
                            const selectedProducts = paymentProducts.filter((item) =>
                              productIds.includes(item.id),
                            );
                            setConfig({
                              productIds,
                              catalogProducts: selectedProducts.map(productSnapshot),
                            });
                          }}
                        />
                        {product.imageUrl && (
                          <img src={product.imageUrl} alt="" className="h-10 w-10 object-cover" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium">{product.name}</span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {product.salePrice != null && product.salePrice < product.price
                              ? `${formatCurrency(product.salePrice, product.currency)} (sale)`
                              : formatCurrency(product.price, product.currency)}
                            {product.variants.length ? ` · ${product.variants.length} variants` : ""}
                            {available != null ? ` · ${available} in stock` : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })}
              </div>
            ) : null}
            */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[12px] font-medium">Allow multiple products</p>
                <p className="text-[10px] text-muted-foreground">Build one cart from all selected items.</p>
              </div>
              <Switch
                checked={field.config?.allowMultipleProducts !== false}
                onCheckedChange={(allowMultipleProducts) => setConfig({ allowMultipleProducts })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[12px] font-medium">Quantity selectors</p>
                <p className="text-[10px] text-muted-foreground">Let customers choose item quantities.</p>
              </div>
              <Switch
                checked={field.config?.showProductQuantity !== false}
                onCheckedChange={(showProductQuantity) => setConfig({ showProductQuantity })}
              />
            </div>
            <p className="text-[10px] leading-4 text-muted-foreground">
              Minimum and maximum quantities are configured on each product.
            </p>
            <div className="space-y-3 border-t border-border pt-4">
              <div>
                <p className="text-[12px] font-medium">Store presentation</p>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  Choose how products and the live order summary appear to respondents.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Display style</Label>
                  <Select
                    value={field.config?.productDisplay?.style || "cards"}
                    onValueChange={(style: NonNullable<FormProductDisplayConfig["style"]>) =>
                      setConfig({
                        productDisplay: {
                          ...field.config?.productDisplay,
                          style,
                        },
                      })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cards">Commerce cards</SelectItem>
                      <SelectItem value="grid">Image grid</SelectItem>
                      <SelectItem value="list">Detailed list</SelectItem>
                      <SelectItem value="compact">Compact rows</SelectItem>
                      <SelectItem value="large">Large feature cards</SelectItem>
                      <SelectItem value="image">Visual gallery</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Columns</Label>
                  <Select
                    value={String(field.config?.productDisplay?.columns || 2)}
                    onValueChange={(value) =>
                      setConfig({
                        productDisplay: {
                          ...field.config?.productDisplay,
                          columns: Number(value) as 1 | 2 | 3 | 4,
                        },
                      })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 column</SelectItem>
                      <SelectItem value="2">2 columns</SelectItem>
                      <SelectItem value="3">3 columns</SelectItem>
                      <SelectItem value="4">4 columns</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 border border-border px-3 py-2">
                  <span>
                    <span className="block text-[12px] font-medium">Order summary</span>
                    <span className="block text-[10px] text-muted-foreground">Show selected items and subtotal.</span>
                  </span>
                  <Switch
                    checked={field.config?.productDisplay?.showOrderSummary !== false}
                    onCheckedChange={(showOrderSummary) =>
                      setConfig({
                        productDisplay: {
                          ...field.config?.productDisplay,
                          showOrderSummary,
                        },
                      })
                    }
                  />
                </label>
                <label className="flex items-center justify-between gap-3 border border-border px-3 py-2">
                  <span>
                    <span className="block text-[12px] font-medium">Hide sold-out items</span>
                    <span className="block text-[10px] text-muted-foreground">Keep unavailable products out of the store.</span>
                  </span>
                  <Switch
                    checked={field.config?.productDisplay?.hideSoldOutProducts !== false}
                    onCheckedChange={(hideSoldOutProducts) =>
                      setConfig({
                        productDisplay: {
                          ...field.config?.productDisplay,
                          hideSoldOutProducts,
                        },
                      })
                    }
                  />
                </label>
              </div>
            </div>
          </div>
        </EditorSection>
      )}

      {field.type === "product" && (
        <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
          <DialogContent className="dashboard-scroll max-h-[86vh] max-w-[560px] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add products from catalog</DialogTitle>
              <DialogDescription>
                Select the products that should appear in this form&apos;s
                Product block. Unselected catalog products stay out of the
                block.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              {paymentProducts.filter((product) => product.billingType === "one_time").length ? (
                paymentProducts
                  .filter((product) => product.billingType === "one_time")
                  .map((product) => {
                    const selected = (field.config?.productIds || []).includes(product.id);
                    return (
                      <label
                        key={product.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 border p-3",
                          selected ? "border-primary bg-primary/5" : "border-border",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleCatalogProduct(product)}
                        />
                        {product.imageUrl || product.imageGallery?.[0] ? (
                          <img src={product.imageUrl || product.imageGallery?.[0]} alt="" className="h-12 w-12 rounded-md object-cover" />
                        ) : (
                          <span className="grid h-12 w-12 place-items-center rounded-md bg-muted text-[9px] text-muted-foreground">No image</span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium">{product.name}</span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {product.salePrice != null && product.salePrice < product.price
                              ? `${formatCurrency(product.salePrice, product.currency)} sale`
                              : formatCurrency(product.price, product.currency)}
                            {product.variants.length ? ` · ${product.variants.length} variants` : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })
              ) : (
                <p className="border border-dashed border-border p-5 text-center text-[11px] text-muted-foreground">
                  Create a one-time product first.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => setCatalogOpen(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {!structural && (
        <EditorSection
          title="Behavior"
          description="Control validation and how this field fits the form."
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium">Required</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Respondents must answer
                </p>
              </div>
              <Switch
                checked={Boolean(field.required)}
                onCheckedChange={(checked) => set("required", checked)}
                aria-label={`${field.label} is required`}
              />
            </div>
            <div className="space-y-2">
              <Label>Width</Label>
              <Select
                value={field.width || "full"}
                onValueChange={(value: "full" | "half") => set("width", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full width</SelectItem>
                  <SelectItem value="half">Half width</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {field.type === "number" || field.type === "rating" || field.type === "scale" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label htmlFor="field-min">Minimum</Label>
                  <Input
                    id="field-min"
                    type="number"
                    value={field.validation?.min ?? ""}
                    onChange={(event) =>
                      set("validation", {
                        ...field.validation,
                        min:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="field-max">Maximum</Label>
                  <Input
                    id="field-max"
                    type="number"
                    value={field.validation?.max ?? ""}
                    onChange={(event) =>
                      set("validation", {
                        ...field.validation,
                        max:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </div>
              </div>
            ) : null}
            {["shortText", "longText", "password"].includes(field.type) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label htmlFor="field-min-length">Minimum characters</Label>
                  <Input
                    id="field-min-length"
                    type="number"
                    min="0"
                    value={field.validation?.minLength ?? ""}
                    onChange={(event) =>
                      set("validation", {
                        ...field.validation,
                        minLength:
                          event.target.value === ""
                            ? undefined
                            : Math.max(0, Number(event.target.value)),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="field-max-length">Maximum characters</Label>
                  <Input
                    id="field-max-length"
                    type="number"
                    min="1"
                    value={field.validation?.maxLength ?? ""}
                    onChange={(event) =>
                      set("validation", {
                        ...field.validation,
                        maxLength:
                          event.target.value === ""
                            ? undefined
                            : Math.max(1, Number(event.target.value)),
                      })
                    }
                  />
                </div>
              </div>
            )}
            {field.type === "calculated" && (
              <div className="space-y-2">
                <Label htmlFor="field-formula">Formula</Label>
                <Input
                  id="field-formula"
                  value={field.formula || ""}
                  onChange={(event) => set("formula", event.target.value)}
                  placeholder="{quantity} * {price}"
                />
              </div>
            )}
            {field.type === "hidden" && (
              <div className="space-y-2">
                <Label htmlFor="field-default-value">Stored value</Label>
                <Input
                  id="field-default-value"
                  value={field.defaultValue || ""}
                  onChange={(event) =>
                    set("defaultValue", event.target.value)
                  }
                  placeholder="Value included with each response"
                />
              </div>
            )}
          </div>
        </EditorSection>
      )}

      {(field.type === "file" || field.type === "multipleFiles" || field.type === "camera") && (
        <EditorSection
          title="Upload rules"
          description="Files are previewed before submission and stored with the response."
        >
          <div className="space-y-4">
            {field.type !== "camera" && (
              <div className="space-y-2">
                <Label>Accepted files</Label>
                <Select
                  value={field.config?.acceptedFileTypes || "any"}
                  onValueChange={(
                    acceptedFileTypes: NonNullable<
                      FormField["config"]
                    >["acceptedFileTypes"],
                  ) => setConfig({ acceptedFileTypes })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any supported file</SelectItem>
                    <SelectItem value="images">Images only</SelectItem>
                    <SelectItem value="documents">Documents only</SelectItem>
                    <SelectItem value="pdf">PDF only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="field-file-limit">Maximum size</Label>
              <div className="relative">
                <Input
                  id="field-file-limit"
                  type="number"
                  min="1"
                  max="10"
                  value={field.config?.maxFileSizeMb || 5}
                  onChange={(event) =>
                    setConfig({
                      maxFileSizeMb: Math.min(
                        10,
                        Math.max(1, Number(event.target.value) || 1),
                      ),
                    })
                  }
                  className="pr-12"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                  MB
                </span>
              </div>
            </div>
            {field.type === "multipleFiles" && (
              <div className="space-y-2">
                <Label htmlFor="field-file-count">Maximum files</Label>
                <Input
                  id="field-file-count"
                  type="number"
                  min="2"
                  max="20"
                  value={field.config?.maxFiles || 5}
                  onChange={(event) =>
                    setConfig({
                      maxFiles: Math.min(
                        20,
                        Math.max(2, Number(event.target.value) || 2),
                      ),
                    })
                  }
                />
              </div>
            )}
          </div>
        </EditorSection>
      )}

      {field.type === "signature" && (
        <EditorSection
          title="Signature pad"
          description="Set the signing surface and ink used on the public form."
        >
          <div className="space-y-4">
            {[
              {
                key: "signaturePenColor" as const,
                label: "Ink color",
                fallback: "#111827",
              },
              {
                key: "signatureBackgroundColor" as const,
                label: "Pad background",
                fallback: "#FFFFFF",
              },
            ].map((control) => (
              <div key={control.key} className="space-y-2">
                <Label htmlFor={`field-${control.key}`}>{control.label}</Label>
                <div className="flex gap-2">
                  <input
                    id={`field-${control.key}`}
                    type="color"
                    value={field.config?.[control.key] || control.fallback}
                    onChange={(event) =>
                      setConfig({ [control.key]: event.target.value })
                    }
                    className="h-10 w-11 cursor-pointer rounded-md border border-input bg-background p-1"
                  />
                  <Input
                    value={field.config?.[control.key] || control.fallback}
                    onChange={(event) =>
                      setConfig({ [control.key]: event.target.value })
                    }
                    aria-label={`${control.label} hex value`}
                    className="font-mono uppercase"
                  />
                </div>
              </div>
            ))}
          </div>
        </EditorSection>
      )}
    </div>
  );
}

function DropTarget({
  onDrop,
}: {
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        setActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setActive(false)}
      onDrop={(event) => {
        setActive(false);
        onDrop(event);
      }}
      className={cn(
        "h-3 transition-all",
        active && "my-1 h-8 rounded-md border border-dashed border-primary bg-primary/5",
      )}
    />
  );
}

const previewOptions = (field: FormField) =>
  field.type === "yesNo"
    ? ["Yes", "No"]
    : field.options?.length
      ? field.options
      : ["Option 1", "Option 2", "Option 3"];

const formatPreviewCurrency = (value: number, currency: string) => {
  return formatCurrency(value || 0, currency);
};

const toFormCatalogProduct = (product: PaymentProduct) => ({
  id: product.id,
  name: product.name,
  description: product.description,
  shortDescription: product.shortDescription,
  sku: product.sku,
  price: product.price,
  salePrice: product.salePrice,
  currency: product.currency,
  imageUrl: product.imageUrl,
  imageGallery: product.imageGallery,
  promotionalBanner: product.promotionalBanner,
  category: product.category,
  categories: product.categories,
  status: product.status,
  availabilityStartAt: product.availabilityStartAt,
  availabilityEndAt: product.availabilityEndAt,
  minQuantity: product.minQuantity,
  maxQuantity: product.maxQuantity,
  onePerCustomer: product.onePerCustomer,
  hideWhenSoldOut: product.hideWhenSoldOut,
  requiresShipping: product.requiresShipping,
  availableQuantity: product.trackInventory ? product.inventoryQuantity : null,
  allowBackorder: product.allowBackorder,
  variants: product.variants
    .filter((variant) => variant.active)
    .map((variant) => ({
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      price: variant.price,
      salePrice: variant.salePrice,
      description: variant.description,
      imageUrl: variant.imageUrl,
      optionValues: variant.optionValues,
      availableQuantity: variant.trackInventory
        ? variant.inventoryQuantity
        : null,
      allowBackorder: variant.allowBackorder,
      weightGrams: variant.weightGrams,
      availabilityStartAt: variant.availabilityStartAt,
      availabilityEndAt: variant.availabilityEndAt,
    })),
});

const updateFormProductSnapshot = (
  form: FormRecord,
  product: PaymentProduct,
): FormRecord => ({
  ...form,
  fields: form.fields.map((field) =>
    field.type !== "product" ||
    !(field.config?.productIds || []).includes(product.id)
      ? field
      : {
          ...field,
          config: {
            ...field.config,
            catalogProducts: (field.config?.catalogProducts || []).map(
              (snapshot) =>
                snapshot.id === product.id
                  ? toFormCatalogProduct(product)
                  : snapshot,
            ),
          },
        },
  ),
});

function CanvasPreviewLabel({ field }: { field: FormField }) {
  if (field.type === "divider" || field.type === "pageBreak") return null;
  return (
    <div>
      <p
        className={cn(
          "maxform-preview-label",
          field.type === "heading"
            ? "text-[20px] font-semibold leading-tight"
            : field.type === "section"
              ? "text-[16px] font-semibold"
              : "text-[13px] font-medium",
        )}
      >
        {field.label || fieldLabel(field.type)}
        {field.required && (
          <span className="ml-1 text-rose-500" aria-hidden="true">
            *
          </span>
        )}
      </p>
      {field.helpText && (
        <p className="maxform-preview-help mt-1 whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
          {field.helpText}
        </p>
      )}
    </div>
  );
}

function PreviewInputBox({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "maxform-preview-control flex min-h-10 items-center rounded-md border border-input bg-background px-3 text-[12px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CanvasFieldPreview({
  currency,
  field,
}: {
  currency: string;
  field: FormField;
}) {
  const options = previewOptions(field);
  const label = <CanvasPreviewLabel field={field} />;

  if (field.type === "divider") {
    return <div className="border-t border-border" aria-hidden="true" />;
  }

  if (field.type === "pageBreak") {
    return (
      <div className="flex items-center gap-3 text-[11px] font-medium uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>{field.label || "Next step"}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  if (field.type === "heading" || field.type === "section") {
    return <div className="space-y-2">{label}</div>;
  }

  if (field.type === "html") {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase text-muted-foreground">
          Safe HTML
        </p>
        <p className="mt-2 line-clamp-3 text-[12px] text-muted-foreground">
          {(field.defaultValue || "Add formatted supporting content.")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()}
        </p>
      </div>
    );
  }

  if (field.type === "hidden") {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
        <p className="text-[12px] font-medium">{field.label || "Hidden field"}</p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {field.defaultValue || "Stored with each response"}
        </p>
      </div>
    );
  }

  if (field.type === "longText") {
    return (
      <div className="space-y-2">
        {label}
        <PreviewInputBox className="min-h-[86px] items-start py-3">
          {field.placeholder || "Long answer"}
        </PreviewInputBox>
      </div>
    );
  }

  if (
    field.type === "shortText" ||
    field.type === "email" ||
    field.type === "phone" ||
    field.type === "number" ||
    field.type === "url" ||
    field.type === "password" ||
    field.type === "date" ||
    field.type === "time" ||
    field.type === "coupon"
  ) {
    return (
      <div className="space-y-2">
        {label}
        <PreviewInputBox>
          {field.placeholder ||
            (field.type === "coupon" ? "Enter code" : fieldLabel(field.type))}
        </PreviewInputBox>
      </div>
    );
  }

  if (field.type === "dateRange") {
    return (
      <div className="space-y-2">
        {label}
        <div className="grid gap-2 sm:grid-cols-2">
          <PreviewInputBox>Start date</PreviewInputBox>
          <PreviewInputBox>End date</PreviewInputBox>
        </div>
      </div>
    );
  }

  if (field.type === "dropdown" || field.type === "appointment") {
    return (
      <div className="space-y-2">
        {label}
        <PreviewInputBox className="justify-between">
          <span>{options[0] || "Select an option"}</span>
          <ChevronDown className="h-4 w-4" />
        </PreviewInputBox>
      </div>
    );
  }

  if (field.type === "radio" || field.type === "yesNo") {
    return (
      <div className="space-y-2">
        {label}
        <div className="grid gap-2 sm:grid-cols-2">
          {options.slice(0, 4).map((option) => (
            <div
              key={option}
              className="flex min-h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-[12px]"
            >
              <span className="h-3 w-3 rounded-full border border-muted-foreground/50" />
              <span className="truncate">{option}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "checkboxes" || field.type === "multiSelect") {
    return (
      <div className="space-y-2">
        {label}
        <div className="grid gap-2 sm:grid-cols-2">
          {options.slice(0, 4).map((option) => (
            <div
              key={option}
              className="flex min-h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-[12px]"
            >
              <span className="h-3 w-3 rounded-sm border border-muted-foreground/50" />
              <span className="truncate">{option}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "rating" || field.type === "scale") {
    const min = field.validation?.min ?? 1;
    const max = field.validation?.max || 5;
    return (
      <div className="space-y-2">
        {label}
        <div className="flex flex-wrap gap-2">
          {Array.from(
            { length: Math.min(8, Math.max(1, max - min + 1)) },
            (_, index) => min + index,
          ).map((score) => (
            <span
              key={score}
              className="grid h-9 w-9 place-items-center rounded-md border border-input bg-background text-[12px]"
            >
              {score}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "ranking") {
    return (
      <div className="space-y-2">
        {label}
        <div className="divide-y divide-border border-y border-border">
          {options.slice(0, 4).map((option, index) => (
            <div key={option} className="flex min-h-9 items-center gap-3 px-2">
              <span className="grid h-5 w-5 place-items-center border text-[10px]">
                {index + 1}
              </span>
              <span className="truncate text-[12px]">{option}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "matrix") {
    const rows = field.config?.matrixRows || [];
    return (
      <div className="space-y-2">
        {label}
        <div className="overflow-hidden rounded-md border border-input bg-background text-[11px]">
          <div className="grid grid-cols-[minmax(100px,1fr)_repeat(3,minmax(54px,0.6fr))] border-b border-border bg-muted/30">
            <span className="p-2" />
            {options.slice(0, 3).map((option) => (
              <span key={option} className="truncate p-2 text-center">{option}</span>
            ))}
          </div>
          {rows.slice(0, 4).map((row) => (
            <div key={row} className="grid grid-cols-[minmax(100px,1fr)_repeat(3,minmax(54px,0.6fr))] border-b border-border last:border-b-0">
              <span className="truncate p-2">{row}</span>
              {options.slice(0, 3).map((option) => (
                <span key={option} className="grid place-items-center p-2">
                  <span className="h-3 w-3 rounded-full border border-muted-foreground/50" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "file" || field.type === "multipleFiles" || field.type === "camera") {
    return (
      <div className="space-y-2">
        {label}
        <div className="flex min-h-[84px] flex-col items-center justify-center rounded-md border border-dashed border-input bg-background text-center">
          {field.type === "camera" ? (
            <Image className="h-5 w-5 text-muted-foreground" />
          ) : (
            <Upload className="h-5 w-5 text-muted-foreground" />
          )}
          <span className="mt-2 text-[11px] text-muted-foreground">
            {field.type === "camera"
              ? "Photo capture"
              : field.type === "multipleFiles"
                ? `Up to ${field.config?.maxFiles || 5} files`
                : "File upload"}
          </span>
        </div>
      </div>
    );
  }

  if (field.type === "signature") {
    return (
      <div className="space-y-2">
        {label}
        <div
          className="flex min-h-[92px] items-end justify-between rounded-md border border-dashed border-input p-3"
          style={{
            backgroundColor:
              field.config?.signatureBackgroundColor || undefined,
          }}
        >
          <span className="text-[11px] text-muted-foreground">Signature</span>
          <span
            className="h-px w-24"
            style={{
              backgroundColor: field.config?.signaturePenColor || "currentColor",
            }}
          />
        </div>
      </div>
    );
  }

  if (field.type === "imageChoice") {
    return (
      <div className="space-y-2">
        {label}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.slice(0, 6).map((option) => (
            <div
              key={option}
              className="relative aspect-[4/3] overflow-hidden rounded-md border border-input bg-background p-2 text-[11px]"
            >
              {field.config?.optionImages?.[option] ? (
                <img
                  src={field.config.optionImages[option]}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <Image className="h-4 w-4 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "absolute inset-x-0 bottom-0 px-2 py-1",
                  field.config?.optionImages?.[option]
                    ? "bg-black/60 text-white"
                    : "bg-background/90",
                )}
              >
                {option}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "product") {
    const selectedProductIds = field.config?.productIds || [];
    const catalogProducts = (field.config?.catalogProducts || []).filter((product) =>
      selectedProductIds.includes(product.id),
    );
    if (catalogProducts.length) {
      return (
        <div className="space-y-2">
          {label}
          <div className={cn(
            "grid gap-2",
            field.config?.productDisplay?.columns === 1
              ? "grid-cols-1"
              : field.config?.productDisplay?.columns === 3
                ? "sm:grid-cols-3"
                : field.config?.productDisplay?.columns === 4
                  ? "sm:grid-cols-2 lg:grid-cols-4"
                  : "sm:grid-cols-2",
          )}>
            {catalogProducts.slice(0, 4).map((product) => (
              <div key={product.id} className="overflow-hidden border border-input bg-background text-[11px]">
                {product.imageUrl || product.imageGallery?.[0] ? (
                  <img src={product.imageUrl || product.imageGallery?.[0]} alt="" className="h-24 w-full object-cover" />
                ) : (
                  <span className="flex h-24 items-center justify-center bg-muted"><Image className="h-5 w-5 text-muted-foreground" /></span>
                )}
                <span className="block min-w-0 p-2.5">
                  <span className="block truncate font-medium">{product.name}</span>
                  <span className="text-muted-foreground">{formatPreviewCurrency(product.price, product.currency)}{product.variants.length ? ` · ${product.variants.length} variants` : ""}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {label}
        <div className="flex min-h-28 flex-col items-center justify-center rounded-md border border-dashed border-input bg-background px-4 text-center">
          <Image className="h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-[12px] font-medium">Product preview</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Select products in the field settings to preview their images, prices, and variations here.
          </p>
        </div>
      </div>
    );
  }

  if (field.type === "calculated") {
    return (
      <div className="space-y-2">
        {label}
        <PreviewInputBox className="font-mono">
          {field.formula || "Calculated value"}
        </PreviewInputBox>
      </div>
    );
  }

  if (field.type === "address") {
    return (
      <div className="space-y-2">
        {label}
        <div className="grid gap-2 sm:grid-cols-2">
          <PreviewInputBox className="sm:col-span-2">Street address</PreviewInputBox>
          <PreviewInputBox>City</PreviewInputBox>
          <PreviewInputBox>Region</PreviewInputBox>
          <PreviewInputBox>Postal code</PreviewInputBox>
          <PreviewInputBox>Country</PreviewInputBox>
        </div>
      </div>
    );
  }

  if (field.type === "location") {
    return (
      <div className="space-y-2">
        {label}
        <PreviewInputBox>Latitude and longitude</PreviewInputBox>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label}
      <PreviewInputBox>{fieldLabel(field.type)}</PreviewInputBox>
    </div>
  );
}

function CanvasField({
  currency,
  field,
  logicCount,
  onDelete,
  onDuplicate,
  onSelect,
  selected,
  themeBlockStyle,
}: {
  currency: string;
  field: FormField;
  logicCount: number;
  onDelete: () => void;
  onDuplicate: () => void;
  onSelect: () => void;
  selected: boolean;
  themeBlockStyle?: FormBlockStyle;
}) {
  const Icon =
    fieldCatalog.find((item) => item.type === field.type)?.icon || FormInput;
  const previewStyle = resolveBuilderBlockStyle(
    field.config?.blockStyle,
    themeBlockStyle,
  );
  const marginStyle = resolveBuilderBlockMargin(
    field.config?.blockStyle,
    themeBlockStyle,
  );
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-maxform-field-id", field.id);
      }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      className={cn(
        "group cursor-pointer border bg-background transition-colors",
        selected
          ? "border-primary ring-1 ring-primary"
          : "border-border hover:border-muted-foreground/50",
      )}
      style={marginStyle}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-muted-foreground">
            {fieldLabel(field.type)}
          </p>
        </div>
        {field.required && (
          <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
            Required
          </span>
        )}
        {logicCount > 0 && (
          <span className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[9px] font-medium text-primary">
            {logicCount} logic {logicCount === 1 ? "rule" : "rules"}
          </span>
        )}
        <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDuplicate();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={`Duplicate ${field.label}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Delete ${field.label}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="pointer-events-none p-4">
        <div className="maxform-builder-field-preview" style={previewStyle}>
          <CanvasFieldPreview currency={currency} field={field} />
        </div>
      </div>
    </div>
  );
}

function BuildCanvas({
  form,
  onChange,
  onApplyToAll,
  onOpenPalette,
  onOpenProperties,
  selectedFieldId,
  setSelectedFieldId,
  onCreateProduct,
  onEditProduct,
  paymentProducts,
  userId,
}: {
  form: FormRecord;
  onChange: (form: FormRecord) => void;
  onApplyToAll?: () => void;
  onOpenPalette: () => void;
  onOpenProperties: () => void;
  selectedFieldId: string | null;
  setSelectedFieldId: (fieldId: string | null) => void;
  onCreateProduct: () => void;
  onEditProduct?: (product: PaymentProduct) => void;
  paymentProducts: PaymentProduct[];
  userId?: string;
}) {
  const addField = (type: FormFieldType, index = form.fields.length) => {
    const nextField = createField(type);
    const fields = [...form.fields];
    fields.splice(index, 0, nextField);
    onChange({ ...form, fields });
    setSelectedFieldId(nextField.id);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, index: number) => {
    event.preventDefault();
    const type = event.dataTransfer.getData(
      "application/x-maxform-field-type",
    ) as FormFieldType;
    const fieldId = event.dataTransfer.getData(
      "application/x-maxform-field-id",
    );
    if (type) {
      addField(type, index);
      return;
    }
    if (!fieldId) return;
    const sourceIndex = form.fields.findIndex((field) => field.id === fieldId);
    if (sourceIndex < 0) return;
    const fields = [...form.fields];
    const [moved] = fields.splice(sourceIndex, 1);
    const target = sourceIndex < index ? index - 1 : index;
    fields.splice(target, 0, moved);
    onChange({ ...form, fields });
  };

  const selectedField =
    form.fields.find((field) => field.id === selectedFieldId) || null;

  return (
    <div className="grid h-[calc(100dvh-220px)] min-h-[520px] overflow-hidden border-y border-border xl:grid-cols-[190px_minmax(0,1fr)_310px]">
      <aside className="dashboard-scroll hidden min-h-0 overscroll-contain overflow-y-auto border-r border-border px-3 py-5 xl:block">
        <FieldPalette onAdd={addField} />
      </aside>

      <div className="dashboard-scroll min-h-0 min-w-0 overscroll-contain overflow-y-auto bg-muted/20">
        <div className="flex items-center justify-between border-b border-border bg-background px-4 py-3 xl:hidden">
          <Button type="button" variant="outline" onClick={onOpenPalette}>
            <Plus className="h-4 w-4" />
            Add field
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onOpenProperties}
            disabled={!selectedField}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Field settings
          </Button>
        </div>
        <div className="mx-auto max-w-[620px] px-4 py-6 sm:px-7 sm:py-8">
          <div className="mb-6 space-y-3">
            <Textarea
              value={form.title}
              onChange={(event) =>
                onChange({ ...form, title: event.target.value })
              }
              rows={1}
              className="min-h-[54px] resize-none overflow-hidden border-0 bg-transparent px-0 text-[24px] font-semibold leading-tight shadow-none focus-visible:ring-0"
              aria-label="Form title"
            />
            <Textarea
              value={form.description}
              onChange={(event) =>
                onChange({ ...form, description: event.target.value })
              }
              className="min-h-[48px] resize-none border-0 bg-transparent px-0 text-[13px] text-muted-foreground shadow-none focus-visible:ring-0"
              placeholder="Add a short description"
              aria-label="Form description"
            />
          </div>

          <DropTarget onDrop={(event) => handleDrop(event, 0)} />
          {form.fields.map((field, index) => (
            <div key={field.id}>
              <CanvasField
                currency={form.settings.payment.currency}
                field={field}
                selected={field.id === selectedFieldId}
                themeBlockStyle={form.settings.theme.blockStyle}
                logicCount={
                  form.settings.logic.filter(
                    (rule) =>
                      rule.sourceFieldId === field.id ||
                      rule.targetFieldId === field.id,
                  ).length
                }
                onSelect={() => setSelectedFieldId(field.id)}
                onDuplicate={() => {
                  const fields = [...form.fields];
                  const copy = {
                    ...field,
                    id: createId("field"),
                    label: `${field.label} copy`,
                    options: field.options ? [...field.options] : undefined,
                    config: field.config
                      ? {
                          ...field.config,
                          optionImages: field.config.optionImages
                            ? { ...field.config.optionImages }
                            : undefined,
                          optionPrices: field.config.optionPrices
                            ? { ...field.config.optionPrices }
                            : undefined,
                        }
                      : undefined,
                  };
                  fields.splice(index + 1, 0, copy);
                  onChange({ ...form, fields });
                  setSelectedFieldId(copy.id);
                }}
                onDelete={() => {
                  onChange({
                    ...form,
                    fields: form.fields.filter((item) => item.id !== field.id),
                    settings: {
                      ...form.settings,
                      logic: form.settings.logic.filter(
                        (rule) =>
                          rule.sourceFieldId !== field.id &&
                          rule.targetFieldId !== field.id,
                      ),
                    },
                  });
                  if (selectedFieldId === field.id) setSelectedFieldId(null);
                }}
              />
              <DropTarget onDrop={(event) => handleDrop(event, index + 1)} />
            </div>
          ))}

          {form.fields.length === 0 && (
            <button
              type="button"
              onClick={onOpenPalette}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, 0)}
              className="flex min-h-[260px] w-full flex-col items-center justify-center rounded-md border border-dashed border-border bg-background text-center hover:border-primary"
            >
              <Plus className="h-5 w-5 text-primary" />
              <p className="mt-3 text-[14px] font-medium">Add your first field</p>
              <p className="mt-1 max-w-[260px] text-[11px] leading-5 text-muted-foreground">
                Drag from the field palette or click to choose a field.
              </p>
            </button>
          )}
        </div>
      </div>

      <aside className="dashboard-scroll hidden min-h-0 overscroll-contain overflow-y-auto border-l border-border xl:block">
          <FieldProperties
            defaultFontFamily="Inter"
            field={selectedField}
            onApplyToAll={onApplyToAll}
            onCreateProduct={onCreateProduct}
            onEditProduct={onEditProduct}
            paymentProducts={paymentProducts}
          onChange={(field) =>
            onChange({
              ...form,
              fields: form.fields.map((item) =>
                item.id === field.id ? field : item,
              ),
            })
          }
        />
      </aside>
    </div>
  );
}

function LogicEditor({
  form,
  onChange,
}: {
  form: FormRecord;
  onChange: (form: FormRecord) => void;
}) {
  const addRule = () => {
    const first = form.fields.find((field) => field.type !== "pageBreak");
    const second = form.fields.find(
      (field) => field.type !== "pageBreak" && field.id !== first?.id,
    );
    if (!first || !second) return;
    onChange({
      ...form,
      settings: {
        ...form.settings,
        logic: [
          ...form.settings.logic,
          {
            id: createId("logic"),
            sourceFieldId: first.id,
            operator: "equals",
            value: "",
            action: "show",
            targetFieldId: second.id,
          },
        ],
      },
    });
  };

  const updateRule = (
    ruleId: string,
    patch: Partial<(typeof form.settings.logic)[number]>,
  ) =>
    onChange({
      ...form,
      settings: {
        ...form.settings,
        logic: form.settings.logic.map((rule) =>
          rule.id === ruleId ? { ...rule, ...patch } : rule,
        ),
      },
    });

  return (
    <div className="py-7">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h2 className="text-[18px] font-semibold">Conditional logic</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Rules update the live preview and are stored with the form schema.
          </p>
        </div>
        <Button type="button" onClick={addRule} disabled={form.fields.length < 2}>
          <Plus className="h-4 w-4" />
          Add rule
        </Button>
      </div>

      <div className="mt-6 border-y border-border">
        {form.settings.logic.map((rule, index) => (
          <div
            key={rule.id}
            className="grid gap-3 border-b border-border py-5 last:border-b-0 xl:grid-cols-[36px_1fr_150px_1fr_120px_1fr_36px]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-[11px] font-semibold">
              {index + 1}
            </span>
            <Select
              value={rule.sourceFieldId}
              onValueChange={(value) =>
                updateRule(rule.id, { sourceFieldId: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {form.fields
                  .filter((field) => field.type !== "pageBreak")
                  .map((field) => (
                    <SelectItem key={field.id} value={field.id}>
                      {field.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select
              value={rule.operator}
              onValueChange={(value: FormLogicOperator) =>
                updateRule(rule.id, { operator: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="equals">equals</SelectItem>
                <SelectItem value="not_equals">does not equal</SelectItem>
                <SelectItem value="contains">contains</SelectItem>
                <SelectItem value="greater_than">is greater than</SelectItem>
                <SelectItem value="less_than">is less than</SelectItem>
                <SelectItem value="is_answered">is answered</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={rule.value}
              onChange={(event) =>
                updateRule(rule.id, { value: event.target.value })
              }
              placeholder="Value"
              disabled={rule.operator === "is_answered"}
            />
            <Select
              value={rule.action}
              onValueChange={(value: FormLogicAction) =>
                updateRule(rule.id, { action: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="show">Show</SelectItem>
                <SelectItem value="hide">Hide</SelectItem>
                <SelectItem value="require">Require</SelectItem>
                <SelectItem value="skip_to">Skip to</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={rule.targetFieldId}
              onValueChange={(value) =>
                updateRule(rule.id, { targetFieldId: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {form.fields.map((field) => (
                  <SelectItem key={field.id} value={field.id}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                onChange({
                  ...form,
                  settings: {
                    ...form.settings,
                    logic: form.settings.logic.filter(
                      (item) => item.id !== rule.id,
                    ),
                  },
                })
              }
              aria-label={`Delete logic rule ${index + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {form.settings.logic.length === 0 && (
          <div className="py-14 text-center">
            <SplitSquareVertical className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-3 text-[13px] font-medium">No logic rules yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Add a rule after the form has at least two fields.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FontPicker({
  onChange,
  value,
}: {
  onChange: (fontFamily: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredFonts = FORM_FONT_OPTIONS.filter((font) =>
    `${font.family} ${font.source}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <Label>Font family</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between font-normal"
          >
            <span className="truncate" style={{ fontFamily: value }}>
              {value}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(360px,calc(100vw-32px))] p-0"
        >
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search fonts"
                className="pl-10"
              />
            </div>
          </div>
          <div className="dashboard-scroll max-h-[320px] overflow-y-auto p-1">
            {filteredFonts.map((font) => (
              <button
                key={font.family}
                type="button"
                onClick={() => {
                  ensureFormFontLoaded(font.family);
                  onChange(font.family);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left hover:bg-accent"
              >
                <span
                  className="min-w-0 flex-1 truncate text-[14px]"
                  style={{ fontFamily: font.family }}
                >
                  {font.family}
                </span>
                <span className="text-[9px] uppercase text-muted-foreground">
                  {font.source}
                </span>
                {value === font.family && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </button>
            ))}
            {filteredFonts.length === 0 && (
              <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">
                No matching fonts
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ThemeImageUpload({
  id,
  kind,
  label,
  onChange,
  value,
}: {
  id: string;
  kind: "cover" | "logo";
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [error, setError] = useState("");

  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Use an image smaller than 2 MB.");
      return;
    }

    void uploadFileToStorage(file, {
      purpose: "form_asset",
      visibility: "public",
    })
      .then((stored) => {
        if (!stored.url) throw new Error("The public image URL is unavailable.");
        onChange(stored.url);
        setError("");
      })
      .catch((uploadError) =>
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "The image could not be uploaded.",
        ),
      );
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="overflow-hidden rounded-md border border-border">
        {value ? (
          <div
            className={cn(
              "relative flex w-full items-center justify-center bg-muted/30",
              kind === "cover" ? "aspect-[16/6]" : "h-[112px]",
            )}
          >
            <img
              src={value}
              alt=""
              className={cn(
                "h-full w-full",
                kind === "cover" ? "object-cover" : "object-contain p-5",
              )}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onChange("")}
              className="absolute right-2 top-2 bg-background/90"
              aria-label={`Remove ${label.toLowerCase()}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <label
            htmlFor={id}
            className="flex min-h-[112px] cursor-pointer flex-col items-center justify-center px-4 text-center hover:bg-accent/50"
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="mt-2 text-[12px] font-medium">
              Upload {label.toLowerCase()}
            </span>
            <span className="mt-1 text-[10px] text-muted-foreground">
              PNG, JPG or WebP, up to 2 MB
            </span>
          </label>
        )}
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={upload}
          className="sr-only"
        />
        {value && (
          <div className="flex justify-end border-t border-border px-3 py-2">
            <Button type="button" variant="ghost" asChild>
              <label htmlFor={id} className="cursor-pointer">
                <Upload className="h-4 w-4" />
                Replace
              </label>
            </Button>
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function ThemeEditor({
  form,
  onChange,
}: {
  form: FormRecord;
  onChange: (form: FormRecord) => void;
}) {
  const theme = form.settings.theme;
  const updateTheme = (patch: Partial<typeof theme>) =>
    onChange({
      ...form,
      settings: {
        ...form.settings,
        theme: { ...theme, ...patch },
      },
    });
  return (
    <div className="grid gap-8 py-7 lg:grid-cols-[400px_minmax(0,1fr)]">
      <div>
        <h2 className="text-[18px] font-semibold">Form theme</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Appearance saved with this form and its published versions.
        </p>

        <section className="mt-6 border-y border-border py-5">
          <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">
            Brand and form text
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Set the accent and default text color. Typography and field appearance are configured in each block&apos;s settings.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <ColorControl
              id="theme-accent"
              label="Accent"
              value={theme.accentColor}
              fallback="#2563EB"
              placeholder="#2563EB"
              onChange={(accentColor) =>
                updateTheme({ accentColor, accentColorMode: "custom" })
              }
            />
            <ColorControl
              id="theme-text"
              label="Form text color"
              value={theme.textColor}
              fallback="#17181A"
              onChange={(textColor) => updateTheme({ textColor })}
            />
          </div>
        </section>

        <section className="border-b border-border py-5">
          <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">
            Page design
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Control the page surface and form width. Field appearance is configured from each field&apos;s block settings.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ColorControl
              id="theme-page-background"
              label="Page background"
              value={theme.backgroundColor}
              fallback="#FFFFFF"
              placeholder="#FFFFFF"
              onChange={(backgroundColor) => updateTheme({ backgroundColor })}
            />
            <div className="space-y-2">
              <Label>Page width</Label>
              <Select
                value={theme.pageLayout}
                onValueChange={(pageLayout: typeof theme.pageLayout) =>
                  updateTheme({ pageLayout })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="wide">Wide</SelectItem>
                  <SelectItem value="full">Full width</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="border-b border-border py-5">
          <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">
            Form container
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Design the form surface and its outer border. These settings do not change individual fields.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ColorControl
              id="theme-container-background"
              label="Container background"
              value={theme.containerBackgroundColor}
              fallback={theme.backgroundColor || "#FFFFFF"}
              placeholder={theme.backgroundColor || "#FFFFFF"}
              onChange={(containerBackgroundColor) =>
                updateTheme({ containerBackgroundColor })
              }
            />
            <ColorControl
              id="theme-container-border"
              label="Container border color"
              value={theme.containerBorderColor}
              fallback="#E0E2E7"
              onChange={(containerBorderColor) =>
                updateTheme({ containerBorderColor })
              }
            />
            <StyleNumberInput
              id="theme-container-border-width"
              label="Border width"
              value={theme.containerBorderWidth}
              max={12}
              onChange={(containerBorderWidth = 0) =>
                updateTheme({ containerBorderWidth })
              }
            />
            <StyleNumberInput
              id="theme-container-radius"
              label="Corner radius"
              value={theme.containerBorderRadius}
              max={48}
              onChange={(containerBorderRadius = 0) =>
                updateTheme({ containerBorderRadius })
              }
            />
            <div className="space-y-2 sm:col-span-2">
              <Label>Border design</Label>
              <Select
                value={theme.containerBorderStyle}
                onValueChange={(
                  containerBorderStyle: typeof theme.containerBorderStyle,
                ) => updateTheme({ containerBorderStyle })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="solid">Solid</SelectItem>
                  <SelectItem value="dashed">Dashed</SelectItem>
                  <SelectItem value="dotted">Dotted</SelectItem>
                  <SelectItem value="none">No border</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="border-b border-border py-5">
          <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">
            Form behavior
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div className="space-y-2">
              <Label>Button style</Label>
              <Select
                value={theme.buttonStyle}
                onValueChange={(buttonStyle: typeof theme.buttonStyle) =>
                  updateTheme({ buttonStyle })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="solid">Solid</SelectItem>
                  <SelectItem value="outline">Outline</SelectItem>
                  <SelectItem value="soft">Soft</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-1 xl:col-span-2">
              <Label>Respondent theme</Label>
              <Select
                value={theme.respondentMode}
                onValueChange={(
                  respondentMode: typeof theme.respondentMode,
                ) => updateTheme({ respondentMode })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Use device theme</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="border-b border-border py-5">
          <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">
            Brand media
          </h3>
          <div className="mt-4 space-y-4">
            <ThemeImageUpload
              id="theme-cover-upload"
              kind="cover"
              label="Cover image"
              value={theme.coverImageUrl}
              onChange={(coverImageUrl) => updateTheme({ coverImageUrl })}
            />
            <ThemeImageUpload
              id="theme-logo-upload"
              kind="logo"
              label="Form logo"
              value={theme.logoUrl}
              onChange={(logoUrl) => updateTheme({ logoUrl })}
            />
          </div>
        </section>

        <section className="border-b border-border py-5">
          <Label htmlFor="theme-css">Custom CSS</Label>
          <Textarea
            id="theme-css"
            value={theme.customCss}
            onChange={(event) =>
              updateTheme({ customCss: event.target.value })
            }
            className="mt-2 min-h-[100px] font-mono text-[11px]"
            placeholder=".maxform-renderer { }"
          />
        </section>
      </div>

      <div className="min-w-0 self-start bg-muted/20 p-4 sm:p-7 lg:sticky lg:top-0">
        <FormRenderer
          form={form}
          couponsEnabled={
            form.settings.payment.allowCoupons ||
            form.fields.some(
              (field) =>
                field.type === "product" &&
                field.config?.productCouponsEnabled === true,
            )
          }
          preview
          compact
        />
      </div>
    </div>
  );
}

function FormPreloaderEditor({
  form,
  onChange,
}: {
  form: FormRecord;
  onChange: (form: FormRecord) => void;
}) {
  return (
    <PreloaderSettingsEditor
      settings={form.settings.theme.preloader}
      onChange={(preloader) =>
        onChange({
          ...form,
          settings: {
            ...form.settings,
            theme: { ...form.settings.theme, preloader },
          },
        })
      }
      idPrefix={`form-preloader-${form.id}`}
      title="Form preloader"
      description="Show a responsive, centered loading screen before this public form appears."
    />
  );
}

const paymentProductInput = (
  product: PaymentProduct,
  patch: Partial<PaymentProductInput> = {},
): PaymentProductInput =>
  normalizeProductQuantityLimits({
    id: product.id,
    name: product.name,
    description: product.description,
    shortDescription: product.shortDescription || "",
    sku: product.sku,
    price: product.price,
    salePrice: product.salePrice ?? null,
    currency: product.currency,
    billingType: product.billingType,
    billingInterval: product.billingInterval,
    imageUrl: product.imageUrl,
    imageGallery: product.imageGallery || [],
    promotionalBanner: product.promotionalBanner || "",
    category: product.category || "",
    categories:
      product.categories || (product.category ? [product.category] : []),
    status: product.status || (product.active ? "active" : "hidden"),
    availabilityStartAt: product.availabilityStartAt || "",
    availabilityEndAt: product.availabilityEndAt || "",
    minQuantity: product.minQuantity ?? 1,
    maxQuantity: product.maxQuantity ?? 1000,
    onePerCustomer: product.onePerCustomer || false,
    hideWhenSoldOut: product.hideWhenSoldOut || false,
    taxable: product.taxable,
    taxRate: product.taxRate,
    requiresShipping: product.requiresShipping,
    trackInventory: product.trackInventory,
    inventoryQuantity: product.inventoryQuantity,
    lowStockThreshold: product.lowStockThreshold,
    allowBackorder: product.allowBackorder,
    weightGrams: product.weightGrams,
    options: product.options,
    variants: product.variants.map((variant) => ({ ...variant })),
    active: product.active,
    ...patch,
  });

function ProductCommercePriceRow({
  onSaved,
  product,
  userId,
}: {
  onSaved: (product: PaymentProduct) => void;
  product: PaymentProduct;
  userId?: string;
}) {
  const [price, setPrice] = useState(product.price);
  const [salePrice, setSalePrice] = useState<number | null>(
    product.salePrice ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPrice(product.price);
    setSalePrice(product.salePrice ?? null);
  }, [product.id, product.price, product.salePrice]);

  const normalizedSalePrice = salePrice && salePrice > 0 ? salePrice : null;
  const dirty = price !== product.price || normalizedSalePrice !== (product.salePrice ?? null);

  const save = async () => {
    if (!userId || price < 0 || (normalizedSalePrice != null && normalizedSalePrice > price)) {
      setError("Sale price must be lower than the base price.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await savePaymentProduct(
        userId,
        paymentProductInput(product, {
          price,
          salePrice: normalizedSalePrice,
        }),
      );
      onSaved(saved);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The product price could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-border p-3">
      <div className="flex items-start gap-3">
        {product.imageUrl || product.imageGallery?.[0] ? (
          <img
            src={product.imageUrl || product.imageGallery?.[0]}
            alt=""
            className="h-12 w-12 shrink-0 rounded-md object-cover"
          />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-muted text-[10px] text-muted-foreground">
            No image
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium">{product.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {product.sku || "No SKU"} · {product.currency}
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <PricingInput
          id={`commerce-price-${product.id}`}
          label="Base price"
          currency={product.currency}
          value={price}
          onValueChange={setPrice}
        />
        <PricingInput
          id={`commerce-sale-price-${product.id}`}
          label="Sale price (optional)"
          currency={product.currency}
          value={salePrice || 0}
          onValueChange={(value) => setSalePrice(value > 0 ? value : null)}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[10px] text-destructive" role="alert">
          {error}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || saving || !userId}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save price
        </Button>
      </div>
    </div>
  );
}

type FormPaymentSettingsValue = FormRecord["settings"]["payment"];

const shippingRuleCountries = (rule: FormShippingRule) =>
  [...new Set([
    ...(rule.countries || []),
    ...rule.country.split(/[\n,]/),
  ].map((value) => value.trim()).filter(Boolean))];

const emptyShippingRule = (): FormShippingRule => ({
  id: createId(),
  name: "",
  active: true,
  country: "",
  countries: [],
  region: "",
  postalCode: "",
  amount: 0,
  freeShippingThreshold: 0,
  rateType: "flat",
  perItemAmount: 0,
  perWeightUnitAmount: 0,
  handlingFee: 0,
  minSubtotal: 0,
  maxSubtotal: 0,
  minQuantity: 0,
  maxQuantity: 0,
  minWeightGrams: 0,
  maxWeightGrams: 0,
  deliveryEstimate: "",
});

function ShippingCountryPicker({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint?: string;
}) {
  const [selectedCountry, setSelectedCountry] = useState("");
  const addCountry = (country: string) => {
    if (!country || value.includes(country)) return;
    onChange([...value, country].slice(0, 250));
    setSelectedCountry("");
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="space-y-2 rounded-md border border-border bg-background p-2">
        <div className="flex flex-wrap gap-1.5">
          {value.map((country) => (
            <span
              key={country}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary"
            >
              <span className="max-w-[150px] truncate">{country}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-primary/15"
                onClick={() => onChange(value.filter((item) => item !== country))}
                aria-label={`Remove ${country}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <CountrySelect
          id={id}
          value={selectedCountry || undefined}
          onChange={(country) => addCountry(country)}
          placeholder="Add a country"
          className="w-full border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        />
      </div>
      <p className="text-[10px] leading-4 text-muted-foreground">
        {hint || "Leave empty to match every country."}
      </p>
    </div>
  );
}

function ShippingRuleEditor({
  currency,
  idPrefix = "shipping-rule",
  index,
  rule,
  onChange,
  onRemove,
}: {
  currency: string;
  idPrefix?: string;
  index: number;
  rule: FormShippingRule;
  onChange: (rule: FormShippingRule) => void;
  onRemove: () => void;
}) {
  const update = (patch: Partial<FormShippingRule>) =>
    onChange({ ...rule, ...patch });
  const rateType: FormShippingRateType = rule.rateType || "flat";
  const fieldId = (name: string) => `${idPrefix}-${index}-${name}`;
  const rulePrice = rateType === "per_item"
    ? rule.perItemAmount ?? rule.amount
    : rateType === "weight"
      ? rule.perWeightUnitAmount ?? rule.amount
      : rule.amount;
  const updateNumber = (key: keyof FormShippingRule, value: string) => {
    const nextValue = Math.max(0, Number(value) || 0);
    update({ [key]: nextValue } as Partial<FormShippingRule>);
  };
  return (
    <div className="space-y-4 border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <MapPin className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium">
              {rule.name?.trim() || `Shipping rule ${index + 1}`}
            </p>
            <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
              The most specific matching rule wins.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-[10px] text-muted-foreground">Active</Label>
          <Switch
            checked={rule.active !== false}
            onCheckedChange={(active) => update({ active })}
            aria-label={`Activate shipping rule ${index + 1}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove shipping rule ${index + 1}`}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={fieldId("name")}>Rule name</Label>
          <Input
            id={fieldId("name")}
            value={rule.name || ""}
            placeholder="US standard delivery"
            onChange={(event) => update({ name: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={fieldId("region")}>Regions or states</Label>
          <Input
            id={fieldId("region")}
            value={rule.region}
            placeholder="CA, Lagos, Ontario (optional)"
            onChange={(event) => update({ region: event.target.value })}
          />
        </div>
      </div>
      <ShippingCountryPicker
        id={fieldId("countries")}
        label="Countries"
        value={shippingRuleCountries(rule)}
        onChange={(countries) =>
          update({ countries, country: countries.join(", ") })
        }
        hint="Select one or more countries. Leave empty for a worldwide rule."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={fieldId("postal")}>
            Postal codes (optional)
          </Label>
          <Input
            id={fieldId("postal")}
            value={rule.postalCode || ""}
            placeholder="100*, 20001, SW1A 1AA"
            onChange={(event) => update({ postalCode: event.target.value })}
          />
          <p className="text-[10px] leading-4 text-muted-foreground">
            Separate patterns with commas. Use * for a prefix match.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Rate type</Label>
          <Select
            value={rateType}
            onValueChange={(value: FormShippingRateType) =>
              update({ rateType: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">Flat rate</SelectItem>
              <SelectItem value="per_item">Per item</SelectItem>
              <SelectItem value="weight">By weight</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PricingInput
          id={fieldId("price")}
          label={rateType === "per_item" ? "Price per item" : rateType === "weight" ? "Price per unit" : "Shipping price"}
          currency={currency}
          value={rulePrice}
          onValueChange={(value) =>
            update(
              rateType === "per_item"
                ? { perItemAmount: value }
                : rateType === "weight"
                  ? { perWeightUnitAmount: value }
                  : { amount: value },
            )
          }
        />
        <PricingInput
          id={fieldId("free")}
          label="Free shipping from"
          currency={currency}
          value={rule.freeShippingThreshold}
          onValueChange={(freeShippingThreshold) =>
            update({ freeShippingThreshold })
          }
        />
        <PricingInput
          id={fieldId("handling")}
          label="Handling fee"
          currency={currency}
          value={rule.handlingFee || 0}
          onValueChange={(handlingFee) => update({ handlingFee })}
        />
        <div className="space-y-2">
          <Label htmlFor={fieldId("delivery")}>
            Delivery estimate
          </Label>
          <Input
            id={fieldId("delivery")}
            value={rule.deliveryEstimate || ""}
            placeholder="3-5 business days"
            onChange={(event) => update({ deliveryEstimate: event.target.value })}
          />
        </div>
      </div>
      <div className="border-t border-border pt-3">
        <div className="mb-3 flex items-start gap-2">
          <Package className="mt-0.5 h-3.5 w-3.5 text-primary" />
          <div>
            <p className="text-[11px] font-medium">Apply only when the cart matches</p>
            <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
              Leave a limit at zero to ignore it. All entered limits must match.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PricingInput
            id={fieldId("min-subtotal")}
            label="Minimum subtotal"
            currency={currency}
            value={rule.minSubtotal || 0}
            onValueChange={(minSubtotal) => update({ minSubtotal })}
          />
          <PricingInput
            id={fieldId("max-subtotal")}
            label="Maximum subtotal"
            currency={currency}
            value={rule.maxSubtotal || 0}
            onValueChange={(maxSubtotal) => update({ maxSubtotal })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor={fieldId("min-quantity")}>Min items</Label>
              <Input
                id={fieldId("min-quantity")}
                type="number"
                min="0"
                value={rule.minQuantity || 0}
                onChange={(event) => updateNumber("minQuantity", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={fieldId("max-quantity")}>Max items</Label>
              <Input
                id={fieldId("max-quantity")}
                type="number"
                min="0"
                value={rule.maxQuantity || 0}
                onChange={(event) => updateNumber("maxQuantity", event.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:col-span-3">
            <div className="space-y-2">
              <Label htmlFor={fieldId("min-weight")}>Min weight (g)</Label>
              <Input
                id={fieldId("min-weight")}
                type="number"
                min="0"
                value={rule.minWeightGrams || 0}
                onChange={(event) => updateNumber("minWeightGrams", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={fieldId("max-weight")}>Max weight (g)</Label>
              <Input
                id={fieldId("max-weight")}
                type="number"
                min="0"
                value={rule.maxWeightGrams || 0}
                onChange={(event) => updateNumber("maxWeightGrams", event.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShippingSettingsEditor({
  compact = false,
  currency,
  idPrefix = "shipping",
  onChange,
  payment,
}: {
  compact?: boolean;
  currency: string;
  idPrefix?: string;
  onChange: (patch: Partial<FormPaymentSettingsValue>) => void;
  payment: FormPaymentSettingsValue;
}) {
  const mode = payment.shippingMode || "flat";
  const policy = payment.shippingCountryPolicy || "worldwide";
  const rulesEnabled = mode === "destination" || mode === "advanced";
  const setMode = (shippingMode: FormShippingMode) =>
    onChange({
      shippingMode,
      shippingRateType:
        shippingMode === "quantity"
          ? "per_item"
          : shippingMode === "weight"
            ? "weight"
            : "flat",
    });
  const updateRule = (index: number, rule: FormShippingRule) =>
    onChange({
      shippingRules: payment.shippingRules.map((item, itemIndex) =>
        itemIndex === index ? rule : item,
      ),
    });
  return (
    <div className={cn("space-y-5 border border-border p-4", compact && "p-3")}>
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Truck className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Shipping profile</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Configure rates that work for any destination. The server rechecks
            the selected address, cart, weight, and rules before payment.
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Shipping strategy</Label>
          <Select value={mode} onValueChange={(value: FormShippingMode) => setMode(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">Flat rate</SelectItem>
              <SelectItem value="quantity">Per item</SelectItem>
              <SelectItem value="weight">By weight</SelectItem>
              <SelectItem value="destination">Destination zones</SelectItem>
              <SelectItem value="advanced">Advanced rules</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] leading-4 text-muted-foreground">
            Destination zones can override the fallback rate. Advanced rules
            also match subtotal, quantity, weight, and postal codes.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Delivery coverage</Label>
          <Select
            value={policy}
            onValueChange={(shippingCountryPolicy: FormPaymentSettingsValue["shippingCountryPolicy"]) =>
              onChange({ shippingCountryPolicy })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="worldwide">Worldwide</SelectItem>
              <SelectItem value="allowlist">Only selected countries</SelectItem>
              <SelectItem value="blocklist">Everywhere except selected</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] leading-4 text-muted-foreground">
            Use the allow/block list to control where this form can accept
            shippable orders.
          </p>
        </div>
      </div>
      {policy !== "worldwide" && (
        <ShippingCountryPicker
          id={`${idPrefix}-coverage-countries`}
          label={policy === "allowlist" ? "Countries you ship to" : "Countries you do not ship to"}
          value={payment.shippingCountries || []}
          onChange={(shippingCountries) => onChange({ shippingCountries })}
          hint="Country codes are stored from the country picker. Leave the policy worldwide to remove the restriction."
        />
      )}
      <div className="space-y-4 border-t border-border pt-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PricingInput
            id={`${idPrefix}-base-amount`}
            label="Base / fallback rate"
            currency={currency}
            value={payment.shippingAmount}
            onValueChange={(shippingAmount) => onChange({ shippingAmount })}
          />
          <PricingInput
            id={`${idPrefix}-handling-fee`}
            label="Handling fee"
            currency={currency}
            value={payment.shippingHandlingFee || 0}
            onValueChange={(shippingHandlingFee) => onChange({ shippingHandlingFee })}
          />
          <PricingInput
            id={`${idPrefix}-free-threshold`}
            label="Free shipping from"
            currency={currency}
            value={payment.freeShippingThreshold}
            onValueChange={(freeShippingThreshold) => onChange({ freeShippingThreshold })}
          />
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-delivery-estimate`}>Default delivery estimate</Label>
            <Input
              id={`${idPrefix}-delivery-estimate`}
              value={payment.shippingDefaultDeliveryEstimate || ""}
              placeholder="3-7 business days"
              onChange={(event) => onChange({ shippingDefaultDeliveryEstimate: event.target.value })}
            />
          </div>
        </div>
        {(mode === "quantity" || mode === "weight" || mode === "advanced") && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(mode === "quantity" || mode === "advanced") && (
              <PricingInput
                id={`${idPrefix}-per-item-amount`}
                label="Price per item"
                currency={currency}
                value={payment.shippingPerItemAmount || 0}
                onValueChange={(shippingPerItemAmount) => onChange({ shippingPerItemAmount })}
              />
            )}
            {(mode === "weight" || mode === "advanced") && (
              <PricingInput
                id={`${idPrefix}-per-weight-amount`}
                label="Price per weight unit"
                currency={currency}
                value={payment.shippingPerWeightUnitAmount || 0}
                onValueChange={(shippingPerWeightUnitAmount) => onChange({ shippingPerWeightUnitAmount })}
              />
            )}
            {(mode === "weight" || mode === "advanced") && (
              <div className="space-y-2">
                <Label>Weight unit</Label>
                <Select
                  value={payment.shippingWeightUnit || "kg"}
                  onValueChange={(shippingWeightUnit: "g" | "kg" | "lb") => onChange({ shippingWeightUnit })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="g">Grams (g)</SelectItem>
                    <SelectItem value="kg">Kilograms (kg)</SelectItem>
                    <SelectItem value="lb">Pounds (lb)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {(mode === "weight" || mode === "advanced") && (
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-package-weight`}>Packaging weight (g)</Label>
                <Input
                  id={`${idPrefix}-package-weight`}
                  type="number"
                  min="0"
                  value={payment.shippingPackageWeightGrams || 0}
                  onChange={(event) =>
                    onChange({
                      shippingPackageWeightGrams: Math.max(0, Number(event.target.value) || 0),
                    })
                  }
                />
              </div>
            )}
          </div>
        )}
      </div>
      {mode === "advanced" && (
        <div className="max-w-[280px] space-y-2">
          <Label>Fallback rate type</Label>
          <Select
            value={payment.shippingRateType || "flat"}
            onValueChange={(shippingRateType: FormShippingRateType) =>
              onChange({ shippingRateType })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">Flat fallback</SelectItem>
              <SelectItem value="per_item">Per-item fallback</SelectItem>
              <SelectItem value="weight">Weight fallback</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] leading-4 text-muted-foreground">
            Used when no advanced rule matches the buyer&apos;s destination or cart.
          </p>
        </div>
      )}
      {rulesEnabled && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Globe2 className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <p className="text-[12px] font-medium">Shipping zones and rules</p>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  Add country, region, postal, cart, weight, and delivery rules.
                  The most specific match wins; the fallback rate applies when
                  no rule matches.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({ shippingRules: [...payment.shippingRules, emptyShippingRule()] })
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add rule
            </Button>
          </div>
          {payment.shippingRules.length === 0 ? (
            <div className="border border-dashed border-border px-4 py-5 text-[11px] leading-5 text-muted-foreground">
              No rules yet. The base shipping rate applies worldwide. Add a
              rule to customize countries, regions, postal codes, or cart
              conditions.
            </div>
          ) : (
            <div className="space-y-3">
              {payment.shippingRules.map((rule, index) => (
                <ShippingRuleEditor
                  key={rule.id || `shipping-rule-${index}`}
                  currency={currency}
                  idPrefix={`${idPrefix}-rule`}
                  index={index}
                  rule={rule}
                  onChange={(nextRule) => updateRule(index, nextRule)}
                  onRemove={() =>
                    onChange({
                      shippingRules: payment.shippingRules.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentEditor({
  form,
  onChange,
  onOpenProviders,
  onProductsChange,
  products,
  providerConnections,
  userId,
}: {
  form: FormRecord;
  onChange: (form: FormRecord) => void;
  onOpenProviders?: () => void;
  onProductsChange?: (products: PaymentProduct[]) => void;
  products: PaymentProduct[];
  providerConnections: PaymentProviderConnection[];
  userId?: string;
}) {
  const payment = form.settings.payment;
  const selectedCommerceProductIds = useMemo(
    () =>
      Array.from(
        new Set(
          form.fields
            .filter((field) => field.type === "product")
            .flatMap((field) => field.config?.productIds || []),
        ),
      ),
    [form.fields],
  );
  const commerceProducts = products.filter(
    (product) =>
      product.billingType === "one_time" &&
      selectedCommerceProductIds.includes(product.id),
  );
  const commerceEnabled =
    commerceProducts.length > 0 &&
    (payment.productCommerceEnabled === true ||
      (payment.productCommerceEnabled == null && payment.mode === "cart"));
  const selectedProduct = products.find(
    (product) => product.id === payment.productId,
  );
  const recurringProduct = selectedProduct?.billingType === "recurring";
  const checkoutConnections = recurringProduct
    ? providerConnections.filter(
        (connection) => connection.provider !== "opay",
      )
    : providerConnections;
  const selectedProviderAvailable =
    payment.provider === "workspace" ||
    checkoutConnections.some(
      (connection) => connection.provider === payment.provider,
    );
  const updatePayment = (patch: Partial<typeof payment>) =>
    onChange({
      ...form,
      settings: {
        ...form.settings,
        payment: { ...payment, ...patch },
      },
    });
  const setProductCommerceEnabled = (enabled: boolean) => {
    if (enabled) {
      if (providerConnections.length === 0) {
        onOpenProviders?.();
        return;
      }
      const firstProduct = commerceProducts[0];
      updatePayment({
        enabled: true,
        productCommerceEnabled: true,
        mode: "cart",
        productId: "",
        amount: 0,
        currency: firstProduct?.currency || payment.currency || "USD",
      });
      return;
    }
    updatePayment({
      enabled: false,
      productCommerceEnabled: false,
      mode: "fixed",
      productId: "",
      amount: 0,
    });
  };
  const saveCommerceProduct = (saved: PaymentProduct) => {
    onProductsChange?.(
      products.map((product) => (product.id === saved.id ? saved : product)),
    );
    onChange(updateFormProductSnapshot(form, saved));
  };
  return (
    <div className="max-w-[720px] py-7">
      {selectedCommerceProductIds.length > 0 && (
        <section className="border-y border-border pb-6">
          <div className="flex items-start justify-between gap-5 border-b border-border py-5">
            <div>
              <h2 className="text-[16px] font-semibold">Product Commerce</h2>
              <p className="mt-1 max-w-[560px] text-[12px] leading-5 text-muted-foreground">
                Product prices, sale prices, quantities, and product coupons
                are managed here. This is separate from the ordinary form
                payment below.
              </p>
            </div>
            <Switch
              checked={commerceEnabled}
              onCheckedChange={setProductCommerceEnabled}
              disabled={commerceProducts.length === 0}
              aria-label="Enable product commerce"
            />
          </div>
          {commerceProducts.length === 0 ? (
            <p className="py-5 text-[11px] text-muted-foreground">
              The selected products are no longer available in the shared
              Payments catalog. Choose active products in the Product field.
            </p>
          ) : (
            <div className="space-y-5 pt-5">
              <div className="space-y-3">
                <div>
                  <p className="text-[13px] font-medium">Products on this form</p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    Editing a price here updates the shared Payments product and
                    every live form that uses it.
                  </p>
                </div>
                <div className="space-y-3">
                  {commerceProducts.map((product) => (
                    <ProductCommercePriceRow
                      key={product.id}
                      product={product}
                      userId={userId}
                      onSaved={saveCommerceProduct}
                    />
                  ))}
                </div>
              </div>
              {userId && (
                <ScopedCouponManager
                  enabled={payment.allowCoupons}
                  onEnabledChange={(allowCoupons) =>
                    updatePayment({
                      mode: "cart",
                      productCommerceEnabled: true,
                      allowCoupons,
                    })
                  }
                  target={{
                    currency: payment.currency,
                    id: form.id,
                    name: form.title || "Untitled form",
                    type: "form",
                  }}
                  productOptions={commerceProducts.map((product) => ({
                    id: product.id,
                    name: product.name,
                  }))}
                  canCreate={commerceEnabled}
                  userId={userId}
                />
              )}
            </div>
          )}
        </section>
      )}
      <div className="flex items-start justify-between gap-6 border-b border-border pb-6">
        <div>
          <h2 className="text-[18px] font-semibold">Form payment</h2>
          <p className="mt-1 max-w-[520px] text-[12px] leading-5 text-muted-foreground">
            Use this for a traditional form charge or a respondent-entered
            amount. Product pricing is managed in Product Commerce above.
          </p>
        </div>
        <Switch
          checked={payment.enabled}
          onCheckedChange={(enabled) => {
            if (enabled && providerConnections.length === 0) {
              onOpenProviders?.();
              return;
            }
            updatePayment({ enabled });
          }}
          disabled={providerConnections.length === 0}
        />
      </div>

      {providerConnections.length === 0 && (
        <div className="my-6 flex flex-col gap-4 border-y border-border py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] font-medium">
              Connect a merchant provider first
            </p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Paid forms need a healthy payment account before they can go
              live.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onOpenProviders}>
            <CreditCard className="h-4 w-4" />
            Open providers
          </Button>
        </div>
      )}

      {payment.enabled ? (
        <div className="grid gap-5 py-6 sm:grid-cols-2">
          {commerceEnabled ? (
            <div className="border border-border bg-muted/20 p-3">
              <p className="text-[12px] font-medium">Product total</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                The amount is calculated from the selected products, variants,
                quantities, and coupons in Product Commerce.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Amount type</Label>
              <Select
                value={payment.mode}
                onValueChange={(value: typeof payment.mode) =>
                  updatePayment({ mode: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                  <SelectItem value="variable">Pay what you want</SelectItem>
                  {!commerceProducts.length && payment.mode === "product" && (
                    <SelectItem value="product">Product checkout</SelectItem>
                  )}
                  {!commerceProducts.length && payment.mode === "cart" && (
                    <SelectItem value="cart">Catalog cart</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select
              value={payment.provider}
              onValueChange={(value: typeof payment.provider) =>
                updatePayment({ provider: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">Workspace default</SelectItem>
                {checkoutConnections.map((connection) => (
                  <SelectItem
                    key={connection.provider}
                    value={connection.provider}
                  >
                    {connection.provider === "opay"
                      ? "OPay"
                      : connection.provider[0].toUpperCase() +
                        connection.provider.slice(1)}
                    {connection.isDefault ? " (default)" : ""}
                  </SelectItem>
                ))}
                {!selectedProviderAvailable &&
                  payment.provider !== "workspace" && (
                    <SelectItem value={payment.provider} disabled>
                      Reconnect selected provider
                    </SelectItem>
                  )}
              </SelectContent>
              </Select>
              {recurringProduct && checkoutConnections.length === 0 && (
                <p className="text-[11px] leading-5 text-destructive">
                  Connect Stripe, PayPal, or Paystack to sell this recurring
                  product.
                </p>
              )}
            </div>
          {payment.mode === "fixed" && (
            <>
              <PricingInput
                id="payment-amount"
                label="Amount"
                currency={payment.currency}
                value={payment.amount}
                onValueChange={(amount) => updatePayment({ amount })}
              />
              <div className="space-y-2">
                <Label htmlFor="payment-currency">Currency</Label>
                <SearchableSelect
                  id="payment-currency"
                  value={payment.currency}
                  onChange={(currency) => updatePayment({ currency })}
                  options={currencyOptions.map((option) => ({
                    value: option.code,
                    label: `${option.code} - ${option.name}`,
                    description: option.countries.slice(0, 2).join(", "),
                    keywords: `${option.symbol} ${option.name} ${option.countries.join(" ")}`,
                  }))}
                  searchPlaceholder="Search currency or country..."
                />
              </div>
            </>
          )}
          {payment.mode === "product" && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Catalog product</Label>
              <Select
                value={payment.productId}
                onValueChange={(productId) => {
                  const product = products.find(
                    (item) => item.id === productId,
                  );
                  updatePayment({
                    productId,
                    amount: product?.price || 0,
                    currency: product?.currency || payment.currency,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name} -{" "}
                      {formatCurrency(product.price, product.currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {products.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Create an active product in Payments before using product
                  checkout.
                </p>
              )}
            </div>
          )}
          {payment.mode === "cart" && (
            <div className="space-y-5 sm:col-span-2">
              <div className="border border-border bg-muted/20 p-4">
                <p className="text-[13px] font-medium">Form cart</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Totals come from catalog products, variants, and quantities selected in Product fields. Prices and stock are rechecked on the server.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-4 border border-border p-3">
                  <span className="text-[12px] font-medium">Calculate product tax</span>
                  <Switch checked={payment.taxEnabled} onCheckedChange={(taxEnabled) => updatePayment({ taxEnabled })} />
                </label>
                <label className="flex items-center justify-between gap-4 border border-border p-3">
                  <span className="text-[12px] font-medium">Charge shipping</span>
                  <Switch checked={payment.shippingEnabled} onCheckedChange={(shippingEnabled) => updatePayment({ shippingEnabled })} />
                </label>
              </div>
              {payment.taxEnabled && (
                <div className="space-y-4 border border-border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-[12px] font-medium">Tax calculation</p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        Use each product&apos;s rate, or apply the most specific destination rule at checkout.
                      </p>
                    </div>
                    <Select
                      value={payment.taxMode}
                      onValueChange={(taxMode: typeof payment.taxMode) => updatePayment({ taxMode })}
                    >
                      <SelectTrigger className="w-full sm:w-[210px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="product">Product tax rates</SelectItem>
                        <SelectItem value="destination">Destination rules</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {payment.taxMode === "destination" && (
                    <div className="space-y-3">
                      <div className="max-w-[220px] space-y-2">
                        <Label htmlFor="payment-destination-tax-rate">Default tax rate (%)</Label>
                        <Input
                          id="payment-destination-tax-rate"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={payment.destinationTaxRate}
                          onChange={(event) =>
                            updatePayment({
                              destinationTaxRate: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[12px] font-medium">Destination tax rules</p>
                            <p className="text-[11px] text-muted-foreground">Country and region use ISO-style values, for example NG and LA.</p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              updatePayment({
                                taxRules: [
                                  ...payment.taxRules,
                                  { country: "", region: "", rate: 0 },
                                ],
                              })
                            }
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add rule
                          </Button>
                        </div>
                        {payment.taxRules.length === 0 ? (
                          <p className="border border-dashed border-border px-3 py-4 text-[11px] text-muted-foreground">
                            No rules yet. The default rate applies to every destination.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {payment.taxRules.map((rule, index) => (
                              <div key={`tax-rule-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_120px_auto]">
                                <Input
                                  aria-label={`Tax rule ${index + 1} country`}
                                  placeholder="Country"
                                  value={rule.country}
                                  onChange={(event) =>
                                    updatePayment({
                                      taxRules: payment.taxRules.map((item, itemIndex) =>
                                        itemIndex === index ? { ...item, country: event.target.value } : item,
                                      ),
                                    })
                                  }
                                />
                                <Input
                                  aria-label={`Tax rule ${index + 1} region`}
                                  placeholder="Region (optional)"
                                  value={rule.region}
                                  onChange={(event) =>
                                    updatePayment({
                                      taxRules: payment.taxRules.map((item, itemIndex) =>
                                        itemIndex === index ? { ...item, region: event.target.value } : item,
                                      ),
                                    })
                                  }
                                />
                                <Input
                                  aria-label={`Tax rule ${index + 1} rate`}
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  placeholder="Rate %"
                                  value={rule.rate}
                                  onChange={(event) =>
                                    updatePayment({
                                      taxRules: payment.taxRules.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, rate: Math.min(100, Math.max(0, Number(event.target.value) || 0)) }
                                          : item,
                                      ),
                                    })
                                  }
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Remove tax rule ${index + 1}`}
                                  onClick={() =>
                                    updatePayment({
                                      taxRules: payment.taxRules.filter((_, itemIndex) => itemIndex !== index),
                                    })
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {payment.shippingEnabled && (
                <ShippingSettingsEditor
                  currency={payment.currency}
                  payment={payment}
                  onChange={updatePayment}
                />
              )}
            </div>
          )}
          <div className="sm:col-span-2">
            <div className="flex items-center gap-4 border border-border bg-muted/20 p-4">
              <CreditCard className="h-5 w-5 text-primary" />
              <div>
                <p className="text-[13px] font-medium">
                  {payment.mode === "fixed"
                    ? formatCurrency(payment.amount, payment.currency)
                    : payment.mode === "variable"
                      ? "Respondent chooses the amount"
                      : payment.mode === "cart"
                        ? "Total comes from the form cart"
                        : "Total comes from product and quantity"}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Provider: {payment.provider === "workspace" ? "workspace default" : payment.provider}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-14 text-center">
          <CreditCard className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-3 text-[13px] font-medium">Payments are off</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Enable them to configure amount, provider, and coupons.
          </p>
        </div>
      )}
      {userId && payment.enabled && !commerceEnabled && (
        <div className="mt-6">
          <ScopedCouponManager
            enabled={payment.allowCoupons}
            onEnabledChange={(allowCoupons) => updatePayment({ allowCoupons })}
            target={{
              currency: payment.currency,
              id: form.id,
              name: form.title || "Untitled form",
              type: "form",
            }}
            canCreate={
              payment.mode === "variable" ||
              payment.mode === "cart" ||
              (payment.mode === "product" && Boolean(payment.productId)) ||
              payment.amount > 0
            }
            userId={userId}
          />
        </div>
      )}
    </div>
  );
}

function ProductImageUpload({
  id,
  onChange,
  value,
}: {
  id: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Use an image smaller than 5 MB.");
      return;
    }
    setUploading(true);
    setError("");
    void uploadFileToStorage(file, {
      purpose: "product_image",
      visibility: "public",
    })
      .then((stored) => {
        if (!stored.url) throw new Error("The public image URL is unavailable.");
        onChange(stored.url);
      })
      .catch((uploadError) =>
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "The image could not be uploaded.",
        ),
      )
      .finally(() => setUploading(false));
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor={id}>Product image</Label>
      <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
        {value ? (
          <div className="relative aspect-[16/9]">
            <img src={value} alt="Product preview" className="h-full w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
              <Button type="button" variant="secondary" size="sm" asChild>
                <label htmlFor={id} className="cursor-pointer">Replace image</label>
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => onChange("")}>Remove</Button>
            </div>
          </div>
        ) : (
          <label htmlFor={id} className="flex min-h-36 cursor-pointer flex-col items-center justify-center px-5 text-center hover:bg-accent/50">
            {uploading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
            <span className="mt-3 text-[12px] font-medium">{uploading ? "Uploading image…" : "Upload product image"}</span>
            <span className="mt-1 text-[10px] text-muted-foreground">PNG, JPG, or WebP · up to 5 MB</span>
          </label>
        )}
        <input id={id} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} className="sr-only" disabled={uploading} />
      </div>
      {error && <p className="text-[11px] text-destructive" role="alert">{error}</p>}
    </div>
  );
}

const newProductDraft = (currency: string): PaymentProductInput => ({
  name: "",
  description: "",
  shortDescription: "",
  sku: "",
  price: 0,
  salePrice: null,
  currency,
  billingType: "one_time",
  billingInterval: null,
  imageUrl: "",
  imageGallery: [],
  promotionalBanner: "",
  category: "",
  categories: [],
  status: "active",
  availabilityStartAt: "",
  availabilityEndAt: "",
  minQuantity: 1,
  maxQuantity: 1000,
  onePerCustomer: false,
  hideWhenSoldOut: false,
  taxable: false,
  taxRate: 0,
  requiresShipping: false,
  trackInventory: false,
  inventoryQuantity: 0,
  lowStockThreshold: 5,
  allowBackorder: false,
  weightGrams: 0,
  options: [],
  variants: [],
  active: true,
});

const productToDraft = (product: PaymentProduct): PaymentProductInput =>
  normalizeProductQuantityLimits({
    ...newProductDraft(product.currency),
    id: product.id,
    name: product.name,
    description: product.description,
    shortDescription: product.shortDescription || "",
    sku: product.sku,
    price: product.price,
    salePrice: product.salePrice ?? null,
    currency: product.currency,
    billingType: product.billingType,
    billingInterval: product.billingInterval,
    imageUrl: product.imageUrl,
    imageGallery: [...(product.imageGallery || [])],
    promotionalBanner: product.promotionalBanner || "",
    category: product.category || "",
    categories:
      product.categories || (product.category ? [product.category] : []),
    status: product.status || (product.active ? "active" : "hidden"),
    availabilityStartAt: product.availabilityStartAt || "",
    availabilityEndAt: product.availabilityEndAt || "",
    minQuantity: product.minQuantity ?? 1,
    maxQuantity: product.maxQuantity ?? 1000,
    onePerCustomer: Boolean(product.onePerCustomer),
    hideWhenSoldOut: Boolean(product.hideWhenSoldOut),
    taxable: product.taxable,
    taxRate: product.taxRate,
    requiresShipping: product.requiresShipping,
    trackInventory: product.trackInventory,
    inventoryQuantity: product.inventoryQuantity,
    lowStockThreshold: product.lowStockThreshold,
    allowBackorder: product.allowBackorder,
    weightGrams: product.weightGrams,
    options: [...product.options],
    variants: product.variants.map((variant) => ({ ...variant })),
    active: product.active,
  });

function CreateProductDialog({
  currency,
  formId,
  onSaved,
  onOpenChange,
  open,
  payment,
  product,
  productCouponsEnabled = false,
  userId,
}: {
  currency: string;
  formId?: string;
  onSaved: (
    product: PaymentProduct,
    payment?: FormRecord["settings"]["payment"],
    productCouponsEnabled?: boolean,
  ) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  payment?: FormRecord["settings"]["payment"];
  product?: PaymentProduct | null;
  productCouponsEnabled?: boolean;
  userId?: string;
}) {
  const [draft, setDraft] = useState<PaymentProductInput>(() => newProductDraft(currency));
  const [initialDraft, setInitialDraft] = useState<PaymentProductInput>(() => newProductDraft(currency));
  const [savedProductForModal, setSavedProductForModal] =
    useState<PaymentProduct | null>(null);
  const [shippingPaymentDraft, setShippingPaymentDraft] = useState(payment);
  const [initialShippingPaymentDraft, setInitialShippingPaymentDraft] = useState(payment);
  const [productCouponsDraftEnabled, setProductCouponsDraftEnabled] = useState(
    productCouponsEnabled,
  );
  const [initialProductCouponsEnabled, setInitialProductCouponsEnabled] = useState(
    productCouponsEnabled,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const closeAllowedRef = useRef(false);
  const initializedOpenRef = useRef(false);

  const updateDraftWithQuantityLimits = (
    patch: Partial<PaymentProductInput>,
  ) => {
    setDraft((current) =>
      normalizeProductQuantityLimits({ ...current, ...patch }),
    );
  };

  useEffect(() => {
    if (!open) {
      initializedOpenRef.current = false;
      closeAllowedRef.current = false;
      return;
    }
    if (initializedOpenRef.current) return;
    initializedOpenRef.current = true;
    const nextDraft = normalizeProductQuantityLimits(
      product ? productToDraft(product) : newProductDraft(currency),
    );
    setSavedProductForModal(null);
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setShippingPaymentDraft(payment);
    setInitialShippingPaymentDraft(payment);
    setProductCouponsDraftEnabled(productCouponsEnabled);
    setInitialProductCouponsEnabled(productCouponsEnabled);
    setExitPromptOpen(false);
    closeAllowedRef.current = false;
    setError("");
  }, [currency, open, payment, product, productCouponsEnabled]);

  const updateShippingPayment = (
    patch: Partial<FormRecord["settings"]["payment"]>,
  ) => {
    setShippingPaymentDraft((current) =>
      current ? { ...current, ...patch } : current,
    );
  };

  const productDraftDirty =
    JSON.stringify(normalizeProductQuantityLimits(draft)) !==
    JSON.stringify(initialDraft);
  const shippingDraftDirty =
    draft.requiresShipping &&
    JSON.stringify(shippingPaymentDraft || null) !==
      JSON.stringify(initialShippingPaymentDraft || null);
  const productCouponsDirty =
    productCouponsDraftEnabled !== initialProductCouponsEnabled;
  const hasUnsavedChanges =
    productDraftDirty || shippingDraftDirty || productCouponsDirty;

  const closeImmediately = () => {
    closeAllowedRef.current = true;
    setExitPromptOpen(false);
    onOpenChange(false);
  };

  const requestClose = () => {
    if (saving) return;
    if (hasUnsavedChanges) {
      setExitPromptOpen(true);
      return;
    }
    closeImmediately();
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (closeAllowedRef.current) {
      closeAllowedRef.current = false;
      return;
    }
    requestClose();
  };

  const save = async (closeAfterSave = false) => {
    if (!userId || !draft.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const editingExistingProduct = Boolean(product || savedProductForModal);
      const normalizedDraft = normalizeProductQuantityLimits(draft);
      const persistedProduct = await savePaymentProduct(
        userId,
        normalizedDraft,
      );
      onSaved(
        persistedProduct,
        normalizedDraft.requiresShipping && shippingPaymentDraft
          ? { ...shippingPaymentDraft, shippingEnabled: true }
          : undefined,
        productCouponsDraftEnabled,
      );
      const stayOpenToConfigureCoupons =
        !editingExistingProduct &&
        !closeAfterSave &&
        Boolean(formId && productCommerceReady && productCouponsDraftEnabled);
      if (stayOpenToConfigureCoupons) {
        const savedDraft = productToDraft(persistedProduct);
        setSavedProductForModal(persistedProduct);
        setDraft(savedDraft);
        setInitialDraft(savedDraft);
        setInitialShippingPaymentDraft(shippingPaymentDraft);
        setInitialProductCouponsEnabled(productCouponsDraftEnabled);
        setError("");
        return;
      }
      closeImmediately();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The product could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const quantityCeiling = draft.trackInventory
    ? Math.min(1000, Math.max(0, Math.floor(draft.inventoryQuantity || 0)))
    : 1000;
  const quantityInputMinimum = quantityCeiling === 0 ? 0 : 1;
  const productCommerceReady = Boolean(
    payment?.enabled &&
      (payment.productCommerceEnabled === true ||
      (payment.productCommerceEnabled == null && payment.mode === "cart")),
  );
  const modalProduct = product || savedProductForModal;

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[92vh] max-w-[760px] overflow-y-auto data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2 data-[state=open]:duration-300">
        <DialogHeader>
          <DialogTitle>{modalProduct ? "Edit form product" : "Create a form product"}</DialogTitle>
          <DialogDescription>
            {modalProduct
              ? "Changes update the shared catalog and every form using this product."
              : "This product is added to the shared Payments catalog and can be reused on other forms."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="form-product-name">Product name</Label>
            <Input
              id="form-product-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Premium T-shirt"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="form-product-sku">SKU</Label>
            <Input
              id="form-product-sku"
              value={draft.sku}
              onChange={(event) => setDraft({
                ...draft,
                sku: event.target.value.toUpperCase().replace(/\s+/g, "-"),
              })}
              placeholder="TSHIRT-001"
            />
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <SearchableSelect
              value={draft.currency}
              onChange={(nextCurrency) => setDraft({ ...draft, currency: nextCurrency })}
              options={currencyOptions.map((option) => ({
                value: option.code,
                label: `${option.code} - ${option.name}`,
              }))}
            />
          </div>
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            <PricingInput
              id="form-product-price"
              label="Base price"
              currency={draft.currency}
              value={draft.price}
              onValueChange={(price) =>
                setDraft({
                  ...draft,
                  price,
                  salePrice:
                    draft.salePrice != null
                      ? Math.min(draft.salePrice, price)
                      : null,
                })
              }
            />
            <PricingInput
              id="form-product-sale-price"
              label="Sale price (optional)"
              currency={draft.currency}
              value={draft.salePrice ?? 0}
              onValueChange={(salePrice) =>
                setDraft({
                  ...draft,
                  salePrice:
                    salePrice > 0 ? Math.min(salePrice, draft.price) : null,
                })
              }
            />
          </div>
          <ProductImageUpload
            id="form-product-image"
            value={draft.imageUrl}
            onChange={(imageUrl) => setDraft({ ...draft, imageUrl })}
          />
          <ProductGalleryUpload
            id="form-product-gallery"
            value={draft.imageGallery || []}
            onChange={(imageGallery) => setDraft({ ...draft, imageGallery })}
          />
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="form-product-description">Description</Label>
            <Textarea
              id="form-product-description"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="form-product-short-description">Short description</Label>
            <Textarea
              id="form-product-short-description"
              value={draft.shortDescription || ""}
              onChange={(event) => setDraft({ ...draft, shortDescription: event.target.value })}
              rows={2}
              placeholder="A concise product summary for cards and checkout."
            />
          </div>
          {formId && userId && (
            <div className="space-y-3 border border-border p-3 sm:col-span-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[12px] font-medium">Product coupons</p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    Create a separate coupon for this product. These coupons are
                    accepted in this form&apos;s product checkout, while
                    form-wide coupons remain managed in Payment.
                  </p>
                </div>
                <Switch
                  checked={productCouponsDraftEnabled}
                  disabled={!product || !productCommerceReady}
                  onCheckedChange={setProductCouponsDraftEnabled}
                  aria-label="Enable product coupons for this product"
                />
              </div>
              {!modalProduct && (
                <p className="border border-dashed border-border px-3 py-2 text-[10px] leading-4 text-muted-foreground">
                  Turn this on before saving to keep the modal open and
                  configure product-specific coupons immediately after the
                  product is created.
                </p>
              )}
              {modalProduct && !productCommerceReady && (
                <p className="border border-dashed border-border px-3 py-2 text-[10px] leading-4 text-muted-foreground">
                  Turn on Product Commerce in the Payment tab before creating
                  product coupons.
                </p>
              )}
              {modalProduct && productCommerceReady && productCouponsDraftEnabled && (
                <ScopedCouponManager
                  canCreate
                  enabled
                  fixedEligibleProductIds={[modalProduct.id]}
                  hideToggle
                  onEnabledChange={() => undefined}
                  scopeLabel={draft.name.trim() || modalProduct.name}
                  target={{
                    currency: draft.currency || currency,
                    id: formId,
                    name: draft.name.trim() || modalProduct.name,
                    type: "form",
                  }}
                  userId={userId}
                />
              )}
            </div>
          )}
          <TagInput
            id="form-product-categories"
            label="Categories"
            value={draft.categories || []}
            onChange={(categories) =>
              setDraft({
                ...draft,
                categories,
                category: categories[0] || "",
              })
            }
            placeholder="Apparel"
          />
          <div className="space-y-2">
            <Label htmlFor="form-product-banner">Promotional badge</Label>
            <Input
              id="form-product-banner"
              value={draft.promotionalBanner || ""}
              onChange={(event) => setDraft({ ...draft, promotionalBanner: event.target.value })}
              placeholder="Best seller"
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={draft.status || "active"}
              onValueChange={(status: NonNullable<PaymentProductInput["status"]>) => setDraft({ ...draft, status, active: status === "active" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="hidden">Hidden</SelectItem>
                <SelectItem value="sold_out">Sold out</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div>
              <Label>Quantity limits</Label>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Set the minimum and maximum units one customer can order.
                {draft.trackInventory
                  ? ` Maximum is capped at ${quantityCeiling} unit${quantityCeiling === 1 ? "" : "s"} by current stock.`
                  : " Turn on inventory tracking to cap the maximum by stock."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="form-product-min-quantity">
                  Minimum quantity per order
                </Label>
                <Input
                  id="form-product-min-quantity"
                  type="number"
                  min={quantityInputMinimum}
                  max={quantityCeiling}
                  value={draft.minQuantity ?? 1}
                  aria-label="Minimum quantity per order"
                  onChange={(event) =>
                    updateDraftWithQuantityLimits({
                      minQuantity: Number(event.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="form-product-max-quantity">
                  Maximum quantity per order
                </Label>
                <Input
                  id="form-product-max-quantity"
                  type="number"
                  min={quantityInputMinimum}
                  max={quantityCeiling}
                  value={draft.maxQuantity ?? 1000}
                  aria-label="Maximum quantity per order"
                  onChange={(event) =>
                    updateDraftWithQuantityLimits({
                      maxQuantity: Number(event.target.value),
                    })
                  }
                />
              </div>
            </div>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Availability window (optional)</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input type="datetime-local" value={draft.availabilityStartAt || ""} aria-label="Product availability start" onChange={(event) => setDraft({ ...draft, availabilityStartAt: event.target.value })} />
              <Input type="datetime-local" value={draft.availabilityEndAt || ""} aria-label="Product availability end" onChange={(event) => setDraft({ ...draft, availabilityEndAt: event.target.value })} />
            </div>
          </div>
          <label className="flex items-center justify-between gap-4 border border-border p-3">
            <span className="text-[12px] font-medium">Track inventory</span>
            <Switch
              checked={draft.trackInventory}
              onCheckedChange={(trackInventory) =>
                updateDraftWithQuantityLimits({ trackInventory })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-4 border border-border p-3">
            <span className="text-[12px] font-medium">Allow backorders</span>
            <Switch checked={draft.allowBackorder} onCheckedChange={(allowBackorder) => setDraft({ ...draft, allowBackorder })} />
          </label>
          {draft.trackInventory && (
            <>
              <div className="space-y-2">
                <Label>Stock quantity</Label>
                <Input
                  type="number"
                  min="0"
                  value={draft.inventoryQuantity}
                  onChange={(event) =>
                    updateDraftWithQuantityLimits({
                      inventoryQuantity: Math.max(
                        0,
                        Number(event.target.value) || 0,
                      ),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Low-stock threshold</Label>
                <Input type="number" min="0" value={draft.lowStockThreshold} onChange={(event) => setDraft({ ...draft, lowStockThreshold: Math.max(0, Number(event.target.value) || 0) })} />
              </div>
            </>
          )}
          <div className="space-y-3 border border-border p-3 sm:col-span-2">
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-[12px] font-medium">Requires shipping</span>
                <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                  Apply the form checkout shipping rules whenever this product is selected.
                </span>
              </span>
              <Switch
                checked={draft.requiresShipping}
                onCheckedChange={(requiresShipping) => {
                  setDraft({ ...draft, requiresShipping });
                  if (requiresShipping) updateShippingPayment({ shippingEnabled: true });
                }}
              />
            </label>
            {draft.requiresShipping && (
              <div className="space-y-4 border-t border-border pt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="form-product-weight">Shipping weight (grams)</Label>
                    <Input
                      id="form-product-weight"
                      type="number"
                      min="0"
                      value={draft.weightGrams}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          weightGrams: Math.max(0, Number(event.target.value) || 0),
                        })
                      }
                    />
                  </div>
                </div>
                {shippingPaymentDraft ? (
                  <ShippingSettingsEditor
                    compact
                    currency={shippingPaymentDraft.currency}
                    idPrefix="form-product-shipping"
                    payment={shippingPaymentDraft}
                    onChange={updateShippingPayment}
                  />
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Shipping prices are configured in this form&apos;s Payment tab.
                  </p>
                )}
              </div>
            )}
          </div>
          <label className="flex items-center justify-between gap-4 border border-border p-3">
            <span className="text-[12px] font-medium">Apply tax</span>
            <Switch checked={draft.taxable} onCheckedChange={(taxable) => setDraft({ ...draft, taxable })} />
          </label>
          <label className="flex items-center justify-between gap-4 border border-border p-3">
            <span>
              <span className="block text-[12px] font-medium">Hide when sold out</span>
              <span className="mt-1 block text-[10px] text-muted-foreground">Keep unavailable items out of public forms.</span>
            </span>
            <Switch checked={draft.hideWhenSoldOut} onCheckedChange={(hideWhenSoldOut) => setDraft({ ...draft, hideWhenSoldOut })} />
          </label>
          <label className="flex items-center justify-between gap-4 border border-border p-3">
            <span>
              <span className="block text-[12px] font-medium">One per customer</span>
              <span className="mt-1 block text-[10px] text-muted-foreground">Reserve one purchase per customer identity.</span>
            </span>
            <Switch checked={draft.onePerCustomer} onCheckedChange={(onePerCustomer) => setDraft({ ...draft, onePerCustomer })} />
          </label>
          {draft.taxable && (
            <div className="space-y-2">
              <Label>Tax rate (%)</Label>
              <Input type="number" min="0" max="100" step="0.001" value={draft.taxRate} onChange={(event) => setDraft({ ...draft, taxRate: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} />
            </div>
          )}
          <div className="space-y-3 border-t border-border pt-4 sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold">Variations</p>
                <p className="text-[10px] text-muted-foreground">Create combinations such as Black / Large.</p>
              </div>
              <Button type="button" variant="outline" onClick={() => setDraft({
                ...draft,
                variants: [...draft.variants, {
                  name: `Variant ${draft.variants.length + 1}`,
                  sku: "",
                  price: draft.price,
                  salePrice: null,
                  description: "",
                  optionValues: {},
                  imageUrl: "",
                  trackInventory: true,
                  inventoryQuantity: 0,
                  lowStockThreshold: 5,
                  allowBackorder: false,
                  active: true,
                  sortOrder: draft.variants.length,
                }],
              })}>
                <Plus className="h-4 w-4" /> Add variation
              </Button>
            </div>
            {draft.variants.map((variant, index) => (
              <div key={index} className="grid gap-3 border border-border p-3 sm:grid-cols-4">
                <Input aria-label={`Variation ${index + 1} name`} value={variant.name} placeholder="Black / Large" onChange={(event) => setDraft({ ...draft, variants: draft.variants.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
                <Input aria-label={`Variation ${index + 1} SKU`} value={variant.sku} placeholder="SKU" onChange={(event) => setDraft({ ...draft, variants: draft.variants.map((item, itemIndex) => itemIndex === index ? { ...item, sku: event.target.value.toUpperCase().replace(/\s+/g, "-") } : item) })} />
                <Input aria-label={`Variation ${index + 1} price`} type="number" min="0" step="0.01" value={variant.price} onChange={(event) => setDraft({ ...draft, variants: draft.variants.map((item, itemIndex) => itemIndex === index ? { ...item, price: Math.max(0, Number(event.target.value) || 0) } : item) })} />
                <div className="flex gap-2">
                  <Input aria-label={`Variation ${index + 1} stock`} type="number" min="0" value={variant.inventoryQuantity} onChange={(event) => setDraft({ ...draft, variants: draft.variants.map((item, itemIndex) => itemIndex === index ? { ...item, inventoryQuantity: Math.max(0, Number(event.target.value) || 0) } : item) })} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove variation ${index + 1}`} onClick={() => setDraft({ ...draft, variants: draft.variants.filter((_, itemIndex) => itemIndex !== index) })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {error && <p className="text-[11px] text-destructive sm:col-span-2" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !userId || !draft.name.trim()}
            onClick={() => void save()}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {modalProduct ? "Save product" : "Create product"}
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>

      <Dialog
        open={exitPromptOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !saving) setExitPromptOpen(false);
        }}
      >
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Save your product changes?</DialogTitle>
            <DialogDescription>
              This product has changes that have not been saved yet. Choose
              whether to keep editing, discard them, or save before closing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setExitPromptOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={saving}
              onClick={closeImmediately}
            >
              Discard changes
            </Button>
            <Button
              type="button"
              disabled={saving || !userId || !draft.name.trim()}
              onClick={() => void save(true)}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save and close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FormBuilder({
  form,
  onChange,
  onPreview,
  onRestoreVersion,
  onSaveDraft,
  manualDraftSaving = false,
  saveState,
  modeOptions = defaultBuilderModes,
  confirmationPanel,
  contactsPanel,
  settingsPanel,
  showToolbarActions = true,
  showHistoryControls = true,
  historyOpen: controlledHistoryOpen,
  onHistoryOpenChange,
  onOpenPaymentProviders,
  paymentProducts = [],
  onPaymentProductsChange,
  providerConnections = [],
  userId,
}: {
  form: FormRecord;
  onChange: (form: FormRecord) => void;
  onPreview: () => void;
  onRestoreVersion: (version: FormVersion) => void;
  onSaveDraft: () => void;
  /** Only a user-triggered save should animate the Save draft control. */
  manualDraftSaving?: boolean;
  saveState: "idle" | "dirty" | "saving" | "saved" | "error";
  modeOptions?: FormBuilderModeOption[];
  confirmationPanel?: ReactNode;
  contactsPanel?: ReactNode;
  settingsPanel?: ReactNode;
  showToolbarActions?: boolean;
  showHistoryControls?: boolean;
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
  onOpenPaymentProviders?: () => void;
  paymentProducts?: PaymentProduct[];
  onPaymentProductsChange?: (products: PaymentProduct[]) => void;
  providerConnections?: PaymentProviderConnection[];
  userId?: string;
}) {
  const [mode, setMode] = useState<BuilderMode>(() => {
    const storedMode = readBuilderMode(form.id);
    return modeOptions.some((option) => option.value === storedMode)
      ? storedMode
      : modeOptions[0]?.value || "build";
  });
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(
    () => readBuilderField(form),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [productCreatorOpen, setProductCreatorOpen] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<PaymentProduct | null>(null);
  const [internalHistoryOpen, setInternalHistoryOpen] = useState(false);
  const historyPastRef = useRef<FormRecord[]>([]);
  const historyFutureRef = useRef<FormRecord[]>([]);
  const historyFormIdRef = useRef(form.id);
  const [, setHistoryRevision] = useState(0);
  const historyOpen = controlledHistoryOpen ?? internalHistoryOpen;
  const setHistoryOpen = (open: boolean) => {
    setInternalHistoryOpen(open);
    onHistoryOpenChange?.(open);
  };
  const selectedField = useMemo(
    () => form.fields.find((field) => field.id === selectedFieldId) || null,
    [form.fields, selectedFieldId],
  );
  const formSignature = useMemo(() => JSON.stringify(form), [form]);
  useEffect(() => {
    if (historyFormIdRef.current === form.id) return;
    historyFormIdRef.current = form.id;
    historyPastRef.current = [];
    historyFutureRef.current = [];
    setHistoryRevision((value) => value + 1);
  }, [form.id]);

  const handleFormChange = useCallback(
    (nextForm: FormRecord) => {
      if (JSON.stringify(nextForm) === formSignature) return;
      historyPastRef.current = [
        ...historyPastRef.current.slice(-49),
        cloneFormRecord(form),
      ];
      historyFutureRef.current = [];
      onChange(nextForm);
      setHistoryRevision((value) => value + 1);
    },
    [form, formSignature, onChange],
  );

  const undoFormChange = useCallback(() => {
    const previous = historyPastRef.current.pop();
    if (!previous) return;
    historyFutureRef.current.push(cloneFormRecord(form));
    onChange(previous);
    setHistoryRevision((value) => value + 1);
  }, [form, onChange]);

  const redoFormChange = useCallback(() => {
    const next = historyFutureRef.current.pop();
    if (!next) return;
    historyPastRef.current.push(cloneFormRecord(form));
    onChange(next);
    setHistoryRevision((value) => value + 1);
  }, [form, onChange]);

  const canUndo = historyPastRef.current.length > 0;
  const canRedo = historyFutureRef.current.length > 0;

  useEffect(() => {
    if (!showHistoryControls) return;

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(
        target.closest(
          "input, textarea, select, [contenteditable=\"true\"], [role=\"textbox\"]",
        ),
      );
    };

    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const undo = key === "z" && !event.shiftKey;
      const redo = (key === "z" && event.shiftKey) || key === "y";
      if (undo && canUndo) {
        event.preventDefault();
        undoFormChange();
      } else if (redo && canRedo) {
        event.preventDefault();
        redoFormChange();
      }
    };

    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [canRedo, canUndo, redoFormChange, showHistoryControls, undoFormChange]);

  const applySelectedFieldStyleToAll = () => {
    if (!selectedField) return;
    const style = cleanBlockStyle({
      ...(selectedField.config?.blockStyle || {}),
    });
    handleFormChange({
      ...form,
      fields: form.fields.map((field) => ({
        ...field,
        config: {
          ...field.config,
          blockStyle: { ...style },
        },
      })),
    });
  };
  const selectedCommerceProducts = useMemo(
    () =>
      paymentProducts.filter((product) =>
        form.fields.some(
          (field) =>
            field.type === "product" &&
            (field.config?.productIds || []).includes(product.id),
        ),
      ),
    [form.fields, paymentProducts],
  );

  const openNewProductDialog = () => {
    setEditingProduct(null);
    setProductCreatorOpen(true);
  };

  const openProductEditor = (product: PaymentProduct) => {
    setEditingProduct(product);
    setProductCreatorOpen(true);
  };

  const handleSavedProduct = (
    product: PaymentProduct,
    paymentOverride?: FormRecord["settings"]["payment"],
    productCouponsEnabledOverride?: boolean,
  ) => {
    onPaymentProductsChange?.([
      product,
      ...paymentProducts.filter((item) => item.id !== product.id),
    ]);
    const withPaymentOverride = (nextForm: FormRecord) =>
      paymentOverride
        ? {
            ...nextForm,
            settings: {
              ...nextForm.settings,
              payment: paymentOverride,
            },
        }
        : nextForm;
    const withProductCouponsOverride = (nextForm: FormRecord) => {
      if (
        productCouponsEnabledOverride == null ||
        selectedField?.type !== "product"
      ) {
        return nextForm;
      }
      return {
        ...nextForm,
        fields: nextForm.fields.map((field) =>
          field.id === selectedField.id
            ? {
                ...field,
                config: {
                  ...field.config,
                  productCouponsEnabled: productCouponsEnabledOverride,
                },
              }
            : field,
        ),
      };
    };
    const withFormOverrides = (nextForm: FormRecord) =>
      withProductCouponsOverride(withPaymentOverride(nextForm));
    if (editingProduct) {
      handleFormChange(withFormOverrides(updateFormProductSnapshot(form, product)));
      return;
    }
    if (selectedField?.type !== "product") {
      if (paymentOverride) handleFormChange(withPaymentOverride(form));
      return;
    }
    const productIds = [
      ...new Set([...(selectedField.config?.productIds || []), product.id]),
    ];
    handleFormChange(
      withFormOverrides({
        ...form,
        fields: form.fields.map((field) =>
          field.id === selectedField.id
            ? {
                ...field,
                config: {
                  ...field.config,
                  productIds,
                  catalogProducts: [
                    ...(field.config?.catalogProducts || []).filter(
                      (item) => item.id !== product.id,
                    ),
                    toFormCatalogProduct(product),
                  ],
                },
              }
            : field,
        ),
      }),
    );
  };

  useEffect(() => {
    const firstProduct = selectedCommerceProducts[0];
    if (!firstProduct) return;
    const payment = form.settings.payment;
    if (
      payment.mode === "cart" &&
      payment.productCommerceEnabled === false
    ) {
      return;
    }
    if (
      payment.mode === "cart" &&
      payment.productCommerceEnabled === true &&
      payment.currency === firstProduct.currency &&
      payment.productId === "" &&
      payment.amount === 0
    ) {
      return;
    }
    handleFormChange({
      ...form,
      settings: {
        ...form.settings,
        payment: {
          ...payment,
          productCommerceEnabled: true,
          mode: "cart",
          productId: "",
          amount: 0,
          currency: firstProduct.currency || payment.currency || "USD",
        },
      },
    });
  }, [form, handleFormChange, selectedCommerceProducts]);

  useEffect(() => {
    let changed = false;
    const fields = form.fields.map((field) => {
      if (field.type !== "product") return field;
      let fieldChanged = false;
      const snapshots = (field.config?.catalogProducts || []).map((snapshot) => {
        const current = paymentProducts.find((product) => product.id === snapshot.id);
        if (!current) return snapshot;
        const nextSnapshot = toFormCatalogProduct(current);
        if (JSON.stringify(nextSnapshot) === JSON.stringify(snapshot)) {
          return snapshot;
        }
        changed = true;
        fieldChanged = true;
        return nextSnapshot;
      });
      return fieldChanged
        ? { ...field, config: { ...field.config, catalogProducts: snapshots } }
        : field;
    });
    if (changed) handleFormChange({ ...form, fields });
  }, [form, handleFormChange, paymentProducts]);

  useEffect(() => {
    try {
      sessionStorage.setItem(builderModeKey(form.id), mode);
    } catch {
      // The builder remains usable when session storage is unavailable.
    }
  }, [form.id, mode]);

  useEffect(() => {
    try {
      if (selectedFieldId) {
        sessionStorage.setItem(
          builderFieldKey(form.id),
          selectedFieldId,
        );
      } else {
        sessionStorage.removeItem(builderFieldKey(form.id));
      }
    } catch {
      // The builder remains usable when session storage is unavailable.
    }
  }, [form.id, selectedFieldId]);

  useEffect(() => {
    if (
      selectedFieldId &&
      form.fields.some((field) => field.id === selectedFieldId)
    ) {
      return;
    }
    setSelectedFieldId(form.fields[0]?.id || null);
  }, [form.fields, selectedFieldId]);

  useEffect(() => {
    if (modeOptions.some((option) => option.value === mode)) return;
    setMode(modeOptions[0]?.value || "build");
  }, [mode, modeOptions]);

  const addFromMobile = (type: FormFieldType) => {
    const field = createField(type);
    handleFormChange({ ...form, fields: [...form.fields, field] });
    setSelectedFieldId(field.id);
    setPaletteOpen(false);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="dashboard-scroll dashboard-scroll-x flex overflow-x-auto">
          {modeOptions.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                scrollDashboardToTop();
              }}
              className={cn(
                "relative h-12 shrink-0 px-4 text-[13px]",
                mode === value
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {mode === value && (
                <span className="absolute inset-x-4 bottom-0 h-[2px] bg-primary" />
              )}
            </button>
          ))}
        </div>
        {(showToolbarActions || showHistoryControls) && (
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 pb-2 sm:pb-0">
            {showToolbarActions && (
              <div className="flex max-w-full flex-wrap items-center gap-2">
                <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
                  {saveState === "saving" ? (
                    <>
                      <Save className="h-3.5 w-3.5 animate-pulse" />
                      Saving
                    </>
                  ) : saveState === "dirty" ? (
                    <>
                      <Save className="h-3.5 w-3.5" />
                      Unsaved changes
                    </>
                  ) : saveState === "error" ? (
                    "Save failed"
                  ) : (
                    <>
                      <CheckSquare className="h-3.5 w-3.5" />
                      Saved
                    </>
                  )}
                </span>
                <Button
                  type="button"
                  onClick={onSaveDraft}
                  disabled={
                    manualDraftSaving ||
                    saveState === "saving" ||
                    (saveState !== "dirty" && saveState !== "error")
                  }
                >
                  {manualDraftSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save draft
                </Button>
                <Button type="button" variant="outline" onClick={onPreview}>
                  <MousePointer2 className="h-4 w-4" />
                  Preview
                </Button>
              </div>
            )}
            {showHistoryControls && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={undoFormChange}
                  disabled={!canUndo}
                  aria-label="Undo last change"
                  title="Undo last change"
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={redoFormChange}
                  disabled={!canRedo}
                  aria-label="Redo last change"
                  title="Redo last change"
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setHistoryOpen(true)}
                  aria-label="Version history"
                >
                  <History className="h-4 w-4" />
                  <span className="hidden sm:inline">History</span>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {mode === "build" && (
        <BuildCanvas
          form={form}
          onChange={handleFormChange}
          onApplyToAll={applySelectedFieldStyleToAll}
          selectedFieldId={selectedFieldId}
          setSelectedFieldId={setSelectedFieldId}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenProperties={() => setPropertiesOpen(true)}
          onCreateProduct={openNewProductDialog}
          onEditProduct={openProductEditor}
          paymentProducts={paymentProducts}
          userId={userId}
        />
      )}
      {mode === "logic" && <LogicEditor form={form} onChange={handleFormChange} />}
      {mode === "theme" && <ThemeEditor form={form} onChange={handleFormChange} />}
      {mode === "preloader" && (
        <FormPreloaderEditor form={form} onChange={handleFormChange} />
      )}
      {mode === "confirmation" && confirmationPanel}
      {mode === "payment" && (
        <PaymentEditor
          form={form}
          onChange={handleFormChange}
          onOpenProviders={onOpenPaymentProviders}
          onProductsChange={onPaymentProductsChange}
          products={paymentProducts}
          providerConnections={providerConnections}
          userId={userId}
        />
      )}
      {mode === "contacts" && contactsPanel}
      {mode === "settings" && settingsPanel}

      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="dashboard-scroll max-h-[86vh] max-w-[520px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add a field</DialogTitle>
            <DialogDescription>
              Choose a field to append to the canvas.
            </DialogDescription>
          </DialogHeader>
          <FieldPalette onAdd={addFromMobile} />
        </DialogContent>
      </Dialog>

      <Dialog open={propertiesOpen} onOpenChange={setPropertiesOpen}>
        <DialogContent className="dashboard-scroll max-h-[86vh] max-w-[520px] overflow-y-auto p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>Field settings</DialogTitle>
            <DialogDescription>
              Configure the selected field without leaving the builder.
            </DialogDescription>
          </DialogHeader>
          <FieldProperties
            defaultFontFamily="Inter"
            field={selectedField}
            onApplyToAll={applySelectedFieldStyleToAll}
            onCreateProduct={openNewProductDialog}
            onEditProduct={openProductEditor}
            paymentProducts={paymentProducts}
            onChange={(field) =>
              handleFormChange({
                ...form,
                fields: form.fields.map((item) =>
                  item.id === field.id ? field : item,
                ),
              })
            }
          />
        </DialogContent>
      </Dialog>

      <CreateProductDialog
        currency={form.settings.payment.currency || "USD"}
        formId={form.id}
        onSaved={handleSavedProduct}
        onOpenChange={(open) => {
          setProductCreatorOpen(open);
          if (!open) setEditingProduct(null);
        }}
        open={productCreatorOpen}
        payment={form.settings.payment}
        product={editingProduct}
        productCouponsEnabled={selectedField?.config?.productCouponsEnabled === true}
        userId={userId}
      />

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              Every publish creates a restorable schema snapshot.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[460px] overflow-y-auto border-y border-border">
            {[...form.settings.versions].reverse().map((version) => (
              <div
                key={version.id}
                className="flex items-center gap-4 border-b border-border py-4 last:border-b-0"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-[11px] font-semibold">
                  v{version.version}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {version.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {new Date(version.publishedAt).toLocaleString()} -{" "}
                    {version.publishedBy}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onRestoreVersion(version);
                    setHistoryOpen(false);
                  }}
                >
                  Restore
                </Button>
              </div>
            ))}
            {form.settings.versions.length === 0 && (
              <div className="py-12 text-center">
                <Redo2 className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-3 text-[13px] font-medium">
                  No published versions yet
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Publish the form to create version 1.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

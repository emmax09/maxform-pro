import {
  defaultFormSettings,
  defaultPayment,
  defaultTheme,
  type AutomationAction,
  type AutomationConnection,
  type AutomationCondition,
  type AutomationProvider,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationRunStep,
  type AutomationWorkflowInput,
  type FormField,
  type FormCatalogProduct,
  type FormCatalogProductVariant,
  type FormAnswerValue,
  type FormConfirmationSettings,
  type FormLogicRule,
  type FormPayment,
  type FormRecord,
  type FormSettings,
  type FormStatus,
  type FormSubmission,
  type FormTemplate,
  type FormTheme,
  type FormWorkflow,
} from "../components/forms/form-types";
import { isValidPhoneNumber } from "react-phone-number-input";
import {
  cloneTemplateFields,
  formTemplates as builtInFormTemplates,
} from "../components/forms/form-templates";
import { query } from "./db";
import { resolveCalculatedAnswer } from "./form-calculations";
import {
  DEFAULT_WORKSPACE_ACCENT,
  LEGACY_FORM_ACCENTS,
  inferAccentColorMode,
  resolveAccentColor,
  workspaceAccentColor,
} from "./workspace-branding";
import {
  hasConnectedPaymentProvider,
  listPaymentProducts,
  listSecureFormPayments,
} from "./payments";
import {
  addContactsToList,
  createContact as createCrmContact,
  syncSubmissionContact,
  updateContact as updateCrmContact,
} from "./contacts";
import {
  dataUrlToBlob,
  deleteStoredObject,
  getStoredObjectAccessBatch,
  uploadFileToStorage,
  type StoredObject,
} from "./storage";

type DatabaseRow = Record<string, unknown>;

type FormsServerDependencies = {
  addContactsToList: typeof addContactsToList;
  createContact: typeof createCrmContact;
  deleteStoredObject: (
    userId: string,
    objectId: string,
  ) => Promise<unknown>;
  executeOAuthAction: (input: {
    actionId: string;
    connectionId: string;
    formId: string;
    submissionId: string;
  }) => Promise<unknown>;
  getWebhookConfig?: (userId: string, connectionId: string) => Promise<{
    endpointUrl: string;
    method: "POST" | "PUT" | "PATCH" | "DELETE" | "GET";
    headers: Record<string, string>;
    query: Record<string, string>;
    bodyTemplate: string;
    authType: "none" | "bearer" | "api_key" | "basic";
    authHeader?: string;
    authSecret?: string;
    username?: string;
    password?: string;
  } | null>;
  getOAuthProviderStatus: typeof getAutomationOAuthProviderStatus;
  getStoredObjectAccessBatch: (
    userId: string,
    objectIds: string[],
  ) => Promise<{
    objects: Array<{ object: StoredObject; url: string }>;
  }>;
  hasConnectedPaymentProvider: typeof hasConnectedPaymentProvider;
  listPaymentProducts: typeof listPaymentProducts;
  listSecureFormPayments: typeof listSecureFormPayments;
  sendEventRegistrationEmail?: (
    eventId: string,
    submissionId: string,
    paid?: boolean,
  ) => Promise<void>;
  sendAutomationEmail: (input: {
    actionId: string;
    formId: string;
    runId: string;
    submissionId: string;
  }) => Promise<{ id?: string; status?: string }>;
  dispatchWorkspaceWorkflowEvent?: (
    workspaceId: string,
    eventType: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ) => Promise<unknown>;
  syncSubmissionContact: typeof syncSubmissionContact;
  updateContact: typeof updateCrmContact;
};

let formsServerDependencies: FormsServerDependencies | null = null;

export const configureFormsServerDependencies = (
  dependencies: FormsServerDependencies,
) => {
  formsServerDependencies = dependencies;
};

const browserRuntime = () => typeof window !== "undefined";

type SubmissionMediaRow = {
  id: string;
  fieldId: string;
  fileKind: "file" | "signature";
  fileName: string;
  mimeType: string;
  fileSize: number;
  content: Blob;
};

type StoredSubmissionMediaRow = Omit<
  SubmissionMediaRow,
  "content"
> & {
  storageObjectId: string;
};

export type FormModulePreferences = {
  accentColor: string;
  accentColorMode?: "workspace" | "custom";
  accessMode: "public" | "authenticated";
  confirmation: FormConfirmationSettings;
  confirmationMessage: string;
  fontFamily: string;
  notificationsEnabled: boolean;
  notificationRecipients: string;
  respondentMode: "auto" | "light" | "dark";
};

export type WorkspaceFormAnalytics = {
  countries: Array<{ count: number; country: string }>;
  daily: Array<{ date: string; responses: number; revenue: number }>;
  devices: Array<{ count: number; device: "Desktop" | "Mobile" | "Tablet" }>;
  forms: Array<{
    completed: number;
    formId: string;
    partial: number;
    responses: number;
    revenue: number;
    title: string;
  }>;
  generatedAt: string;
  totals: {
    completed: number;
    currency: string;
    paidResponses: number;
    partial: number;
    responses: number;
    revenue: number;
  };
};

export const defaultFormModulePreferences: FormModulePreferences = {
  accentColor: DEFAULT_WORKSPACE_ACCENT,
  accessMode: "public",
  confirmation: {
    ...defaultFormSettings().confirmation,
    accentColor: DEFAULT_WORKSPACE_ACCENT,
    useModuleDefault: false,
  },
  confirmationMessage: "Thanks. Your response has been received.",
  fontFamily: "Inter",
  notificationsEnabled: true,
  notificationRecipients: "",
  respondentMode: "auto",
};

const asString = (value: unknown) =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const asNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const asBoolean = (value: unknown) =>
  value === true || value === "true" || value === 1;

const formsDataRequest = async <T>(
  action: string,
  init: RequestInit = {},
  parameters: Record<string, string> = {},
) => {
  const token =
    typeof localStorage === "undefined"
      ? ""
      : localStorage.getItem("access_token") || "";
  const search = new URLSearchParams({ action, ...parameters });
  const timeout = AbortSignal.timeout(12_000);
  try {
    const response = await fetch(`/api/forms/data?${search.toString()}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      signal: init.signal || timeout,
    });
    const result = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(result.error || "Forms could not be loaded.");
    }
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Forms are taking longer than expected. Try again.");
    }
    throw error;
  }
};

const formsRpc = async <T>(
  operation: string,
  args: Record<string, unknown> = {},
) => {
  const result = await formsDataRequest<{ value: T }>("rpc", {
    method: "POST",
    body: JSON.stringify({ operation, args }),
  });
  return result.value;
};

const paymentProviderConnected = (
  ...args: Parameters<typeof hasConnectedPaymentProvider>
) =>
  formsServerDependencies
    ? formsServerDependencies.hasConnectedPaymentProvider(...args)
    : hasConnectedPaymentProvider(...args);

const paymentProductsForWorkspace = (
  ...args: Parameters<typeof listPaymentProducts>
) =>
  formsServerDependencies
    ? formsServerDependencies.listPaymentProducts(...args)
    : listPaymentProducts(...args);

const secureFormPayments = (
  ...args: Parameters<typeof listSecureFormPayments>
) =>
  formsServerDependencies
    ? formsServerDependencies.listSecureFormPayments(...args)
    : listSecureFormPayments(...args);

const removeStoredObject = (userId: string, objectId: string) =>
  formsServerDependencies
    ? formsServerDependencies.deleteStoredObject(userId, objectId)
    : deleteStoredObject(objectId);

const storedObjectAccessBatch = async (
  userId: string,
  objectIds: string[],
) => {
  if (formsServerDependencies) {
    const result =
      await formsServerDependencies.getStoredObjectAccessBatch(
        userId,
        objectIds,
      );
    return result.objects;
  }
  return getStoredObjectAccessBatch(objectIds);
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const createUuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
};

const parseBase64DataUrl = (dataUrl: string) => {
  const match = dataUrl.match(
    /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i,
  );
  if (!match) return null;
  const padding = match[2].endsWith("==")
    ? 2
    : match[2].endsWith("=")
      ? 1
      : 0;
  return {
    mimeType: match[1].toLowerCase(),
    size: Math.max(0, Math.floor((match[2].length * 3) / 4) - padding),
  };
};

const acceptsFileType = (
  field: FormField,
  mimeType: string,
  fileName: string,
) => {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  if (field.type === "camera") return mimeType.startsWith("image/");
  switch (field.config?.acceptedFileTypes) {
    case "images":
      return mimeType.startsWith("image/");
    case "pdf":
      return mimeType === "application/pdf" || extension === "pdf";
    case "documents":
      return new Set([
        "csv",
        "doc",
        "docx",
        "pdf",
        "rtf",
        "txt",
        "xls",
        "xlsx",
      ]).has(extension);
    default:
      return true;
  }
};

const normalizedFileName = (value: string, fallback: string) =>
  (value.split(/[\\/]/).pop() || fallback)
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 180) || fallback;

const submissionConditionMatches = (
  rule: FormLogicRule,
  answers: Record<string, unknown>,
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

const isSubmissionFieldVisible = (
  field: FormField,
  form: FormRecord,
  answers: Record<string, unknown>,
) =>
  form.settings.logic
    .filter(
      (rule) =>
        rule.targetFieldId === field.id &&
        (rule.action === "show" || rule.action === "hide"),
    )
    .every((rule) => {
      const matches = submissionConditionMatches(rule, answers);
      return rule.action === "show" ? matches : !matches;
    });

const isSubmissionFieldRequired = (
  field: FormField,
  form: FormRecord,
  answers: Record<string, unknown>,
) =>
  Boolean(field.required) ||
  form.settings.logic.some(
    (rule) =>
      rule.targetFieldId === field.id &&
      rule.action === "require" &&
      submissionConditionMatches(rule, answers),
  );

const validDateOnly = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const validateStandardAnswer = (field: FormField, value: unknown) => {
  // The annotation is on the variable, not the arrow. Control-flow analysis
  // only treats a call as terminating when the *binding* is declared to return
  // never, so with the annotation on the arrow alone every guard below that
  // ends in fail() left its value un-narrowed.
  const fail: (message: string) => never = (message) => {
    throw new Error(`${field.label} ${message}.`);
  };
  const options =
    field.type === "yesNo"
      ? ["Yes", "No"]
      : field.options?.length
        ? field.options
        : field.type === "appointment"
          ? ["09:00", "10:30", "13:00", "15:30"]
          : ["Option 1", "Option 2", "Option 3"];

  if (field.type === "email") {
    if (
      typeof value !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ) {
      fail("must be a valid email address");
    }
    return;
  }
  if (field.type === "phone") {
    if (typeof value !== "string" || !isValidPhoneNumber(value)) {
      fail("must be a valid phone number");
    }
    return;
  }
  if (field.type === "url") {
    try {
      const url = new URL(String(value));
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        fail("must be a valid web address");
      }
    } catch {
      fail("must be a valid web address");
    }
    return;
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail("must be a number");
    }
    const numericValue = value as number;
    if (
      field.validation?.min != null &&
      numericValue < field.validation.min
    ) {
      fail(`must be at least ${field.validation.min}`);
    }
    if (
      field.validation?.max != null &&
      numericValue > field.validation.max
    ) {
      fail(`must be no more than ${field.validation.max}`);
    }
    return;
  }
  if (field.type === "rating" || field.type === "scale") {
    const score = Number(value);
    const minimum = field.validation?.min ?? 1;
    const maximum = field.validation?.max ?? 5;
    if (
      !Number.isInteger(score) ||
      score < minimum ||
      score > maximum
    ) {
      fail(`must be between ${minimum} and ${maximum}`);
    }
    return;
  }
  if (field.type === "date") {
    if (typeof value !== "string" || !validDateOnly(value)) {
      fail("must be a valid date");
    }
    return;
  }
  if (field.type === "time") {
    if (
      typeof value !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    ) {
      fail("must be a valid time");
    }
    return;
  }
  if (field.type === "dateRange") {
    const [start, end, extra] = String(value).split("|");
    if (
      extra != null ||
      !validDateOnly(start) ||
      !validDateOnly(end) ||
      start > end
    ) {
      fail("must contain a valid start and end date");
    }
    return;
  }
  if (
    field.type === "dropdown" ||
    field.type === "multiSelect" ||
    field.type === "radio" ||
    field.type === "yesNo" ||
    field.type === "appointment" ||
    field.type === "imageChoice"
  ) {
    if (field.type !== "multiSelect" && (typeof value !== "string" || !options.includes(value))) {
      fail("contains an unavailable option");
    }
    if (
      field.type === "multiSelect" &&
      (!Array.isArray(value) ||
        !value.every((item) => typeof item === "string" && options.includes(item)) ||
        new Set(value).size !== value.length)
    ) {
      fail("contains an unavailable option");
    }
    return;
  }
  if (field.type === "product") {
    const catalog = field.config?.catalogProducts || [];
    if (catalog.length === 0) {
      if (typeof value !== "string" || !options.includes(value)) {
        fail("contains an unavailable product");
      }
      return;
    }
    if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
      fail("must contain at least one available product");
    }
    if (field.config?.allowMultipleProducts === false && value.length > 1) {
      fail("allows only one product");
    }
    const allowedIds = new Set(field.config?.productIds || catalog.map((product) => product.id));
    const seen = new Set<string>();
    // Product quantity limits are owned by the catalog product. The old
    // field-level values remain readable for older form JSON but must not cap
    // a product that is reused across multiple forms.
    const minimum = 1;
    const maximum = 1000;
    for (const rawSelection of value) {
      const selection = asObject(rawSelection);
      const productId = asString(selection?.productId);
      const variantId = asString(selection?.variantId);
      const quantity = Number(selection?.quantity);
      const product = catalog.find((item) => item.id === productId);
      if (!selection || !product || !allowedIds.has(productId) || seen.has(productId)) {
        fail("contains an unavailable or duplicate product");
      }
      seen.add(productId);
      const variant = variantId
        ? product.variants.find((item) => item.id === variantId)
        : undefined;
      if ((product.variants.length > 0 && !variant) || (product.variants.length === 0 && variantId)) {
        fail("contains an unavailable product variation");
      }
      const productMinimum = Math.max(minimum, product.minQuantity ?? minimum);
      const productMaximum = Math.min(
        maximum,
        Math.max(productMinimum, product.maxQuantity ?? maximum),
      );
      if (!Number.isInteger(quantity) || quantity < productMinimum || quantity > productMaximum) {
        fail(`quantity must be between ${productMinimum} and ${productMaximum}`);
      }
      const available = variant
        ? variant.availableQuantity
        : product.availableQuantity;
      const allowBackorder = variant?.allowBackorder ?? product.allowBackorder;
      if (available != null && !allowBackorder && quantity > available) {
        fail("quantity is no longer in stock");
      }
    }
    return;
  }
  if (field.type === "checkboxes" || field.type === "ranking") {
    if (
      !Array.isArray(value) ||
      !value.every(
        (item) => typeof item === "string" && options.includes(item),
      ) ||
      new Set(value).size !== value.length ||
      (field.type === "ranking" && value.length !== options.length)
    ) {
      fail("contains an unavailable option");
    }
    return;
  }
  if (
    (field.type === "shortText" ||
      field.type === "longText" ||
      field.type === "password" ||
      field.type === "coupon" ||
      field.type === "hidden") &&
    typeof value !== "string"
  ) {
    fail("must be text");
  }
  if (typeof value === "string" && field.validation?.minLength != null && value.length < field.validation.minLength) {
    fail(`must contain at least ${field.validation.minLength} characters`);
  }
  if (typeof value === "string" && field.validation?.maxLength != null && value.length > field.validation.maxLength) {
    fail(`must contain no more than ${field.validation.maxLength} characters`);
  }
  if (field.type === "matrix") {
    const answer = asObject(value);
    const rows = field.config?.matrixRows || [];
    if (
      !answer ||
      rows.length === 0 ||
      rows.some((row) => !options.includes(asString(answer[row]))) ||
      Object.keys(answer).some((row) => !rows.includes(row))
    ) {
      fail("must include one available choice for every row");
    }
    return;
  }
  if (field.type === "address") {
    const answer = asObject(value);
    if (
      !answer ||
      !asString(answer.street).trim() ||
      !asString(answer.city).trim() ||
      !asString(answer.country).trim() ||
      Object.values(answer).some((part) => typeof part !== "string")
    ) {
      fail("must include a street, city, and country");
    }
    return;
  }
  if (field.type === "location") {
    const answer = asObject(value);
    const latitude = Number(answer?.latitude);
    const longitude = Number(answer?.longitude);
    if (
      !answer ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      fail("must include valid latitude and longitude coordinates");
    }
    return;
  }
  if (
    typeof value === "string" &&
    field.validation?.pattern
  ) {
    let pattern: RegExp | null = null;
    try {
      pattern = new RegExp(field.validation.pattern);
    } catch {
      // An invalid owner-authored pattern should not block respondents.
    }
    if (pattern && !pattern.test(value)) {
      fail("does not match the expected format");
    }
  }
};

export function prepareFormSubmissionAnswers(
  form: FormRecord,
  answers: Record<string, FormAnswerValue | unknown>,
) {
  const storedAnswers: Record<string, unknown> = {};
  const media: SubmissionMediaRow[] = [];
  const resolvedAnswers: Record<string, unknown> = { ...answers };
  const nonResponseTypes = new Set([
    "divider",
    "heading",
    "html",
    "pageBreak",
    "section",
    "orderSummary",
  ]);

  const prepareFile = (field: FormField, rawValue: unknown) => {
    const file = asObject(rawValue);
    if (file?.kind !== "file") {
      throw new Error(`Choose a file for ${field.label}.`);
    }
    const selectedFile =
      typeof Blob !== "undefined" && file.file instanceof Blob
        ? file.file
        : null;
    const dataUrl = asString(file.dataUrl);
    const declaredMimeType = asString(file.mimeType).toLowerCase();
    const parsed = selectedFile
      ? {
          mimeType:
            selectedFile.type.toLowerCase() ||
            declaredMimeType ||
            "application/octet-stream",
          size: selectedFile.size,
        }
      : parseBase64DataUrl(dataUrl);
    if (!parsed || (!selectedFile && !dataUrl)) {
      throw new Error(`Choose ${field.label} again before submitting.`);
    }
    if (
      declaredMimeType &&
      declaredMimeType !== "application/octet-stream" &&
      declaredMimeType !== parsed.mimeType
    ) {
      throw new Error(`The selected file for ${field.label} is not valid.`);
    }
    const requestedFileName = normalizedFileName(
      asString(file.fileName),
      field.type === "camera" ? "camera-upload" : "upload",
    );
    if (!acceptsFileType(field, parsed.mimeType, requestedFileName)) {
      throw new Error(`Choose an accepted file type for ${field.label}.`);
    }
    const maximumMb = Math.min(10, Math.max(1, field.config?.maxFileSizeMb || 5));
    if (parsed.size > maximumMb * 1024 * 1024) {
      throw new Error(`${field.label} must be smaller than ${maximumMb} MB.`);
    }
    const id = createUuid();
    const fileName = requestedFileName;
    media.push({
      id,
      fieldId: field.id,
      fileKind: "file",
      fileName,
      mimeType: parsed.mimeType,
      fileSize: parsed.size,
      content: selectedFile
        ? selectedFile.type
          ? selectedFile
          : new Blob([selectedFile], { type: parsed.mimeType })
        : dataUrlToBlob(dataUrl),
    });
    return {
      kind: "file",
      fileId: id,
      fileName,
      mimeType: parsed.mimeType,
      size: parsed.size,
    };
  };

  form.fields.forEach((field) => {
    if (field.type === "hidden") {
      resolvedAnswers[field.id] = field.defaultValue || "";
    } else if (
      field.type === "ranking" &&
      resolvedAnswers[field.id] == null &&
      field.options?.length
    ) {
      resolvedAnswers[field.id] = [...field.options];
    }
  });
  form.fields.forEach((field) => {
    if (field.type === "calculated") {
      resolvedAnswers[field.id] = resolveCalculatedAnswer(
        field,
        form.fields,
        resolvedAnswers,
      );
    }
  });

  form.fields.forEach((field) => {
    if (nonResponseTypes.has(field.type)) return;
    const visible = isSubmissionFieldVisible(field, form, resolvedAnswers);
    if (!visible) return;
    const value =
      resolvedAnswers[field.id] ??
      (field.defaultValue != null && field.defaultValue !== ""
        ? field.defaultValue
        : undefined);
    const missing =
      value == null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0);
    if (missing) {
      if (isSubmissionFieldRequired(field, form, resolvedAnswers)) {
        throw new Error(`Answer ${field.label} before submitting.`);
      }
      return;
    }

    if (field.type === "file" || field.type === "camera") {
      storedAnswers[field.id] = prepareFile(field, value);
      return;
    }

    if (field.type === "multipleFiles") {
      if (!Array.isArray(value)) {
        throw new Error(`Choose files for ${field.label}.`);
      }
      const maximumFiles = Math.min(20, Math.max(2, field.config?.maxFiles || 5));
      if (value.length > maximumFiles) {
        throw new Error(`${field.label} accepts no more than ${maximumFiles} files.`);
      }
      storedAnswers[field.id] = value.map((file) => prepareFile(field, file));
      return;
    }

    if (field.type === "signature") {
      const signature = asObject(value);
      if (signature?.kind !== "signature") {
        throw new Error(`Add a signature for ${field.label}.`);
      }
      const dataUrl = asString(signature.dataUrl);
      const parsed = parseBase64DataUrl(dataUrl);
      if (!parsed || parsed.mimeType !== "image/png") {
        throw new Error(`Add ${field.label} again before submitting.`);
      }
      if (parsed.size > 2 * 1024 * 1024) {
        throw new Error(`${field.label} is too large. Clear it and sign again.`);
      }
      const id = createUuid();
      media.push({
        id,
        fieldId: field.id,
        fileKind: "signature",
        fileName: `${field.id}-signature.png`.slice(0, 180),
        mimeType: parsed.mimeType,
        fileSize: parsed.size,
        content: dataUrlToBlob(dataUrl),
      });
      storedAnswers[field.id] = {
        kind: "signature",
        fileId: id,
        mimeType: parsed.mimeType,
      };
      return;
    }

    validateStandardAnswer(field, value);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      (Array.isArray(value) &&
        (value.every((item) => typeof item === "string") ||
          (field.type === "product" && value.every((item) => Boolean(asObject(item)))))) ||
      (typeof value === "object" && !Array.isArray(value))
    ) {
      storedAnswers[field.id] = value;
      return;
    }

    throw new Error(`Check the answer for ${field.label} and try again.`);
  });

  return { media, storedAnswers };
}

/**
 * Rebuilds a submission from the published form definition. This runs on the
 * server after uploads have been verified and prevents a custom client from
 * bypassing required fields, logic, option lists, calculations, or upload
 * rules.
 */
export function canonicalizePreparedFormSubmission(
  form: FormRecord,
  suppliedAnswers: Record<string, unknown>,
  suppliedMedia: Array<
    Pick<
      StoredSubmissionMediaRow,
      "fieldId" | "fileKind" | "fileName" | "mimeType" | "fileSize" | "storageObjectId"
    > & { id: string }
  >,
) {
  const canonical: Record<string, unknown> = {};
  const resolved: Record<string, unknown> = { ...suppliedAnswers };
  const nonResponseTypes = new Set([
    "divider",
    "heading",
    "html",
    "pageBreak",
    "section",
    "orderSummary",
  ]);

  form.fields.forEach((field) => {
    if (field.type === "hidden") {
      resolved[field.id] = field.defaultValue || "";
    } else if (
      field.type === "ranking" &&
      resolved[field.id] == null &&
      field.options?.length
    ) {
      resolved[field.id] = [...field.options];
    }
  });
  form.fields.forEach((field) => {
    if (field.type === "calculated") {
      resolved[field.id] = resolveCalculatedAnswer(field, form.fields, resolved);
    }
  });

  const usedMedia = new Set<string>();
  form.fields.forEach((field) => {
    if (nonResponseTypes.has(field.type)) return;
    if (!isSubmissionFieldVisible(field, form, resolved)) return;
    const value =
      resolved[field.id] ??
      (field.defaultValue != null && field.defaultValue !== ""
        ? field.defaultValue
        : undefined);
    const fieldMedia = suppliedMedia.filter((item) => item.fieldId === field.id);
    const missing =
      value == null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0);

    if (["file", "camera", "signature", "multipleFiles"].includes(field.type)) {
      const maximumFiles =
        field.type === "multipleFiles"
          ? Math.min(20, Math.max(2, field.config?.maxFiles || 5))
          : 1;
      if (fieldMedia.length > maximumFiles) {
        throw new Error(`${field.label} contains too many uploaded files.`);
      }
      if (fieldMedia.length === 0) {
        if (isSubmissionFieldRequired(field, form, resolved)) {
          throw new Error(`Answer ${field.label} before submitting.`);
        }
        return;
      }
      const expectedKind = field.type === "signature" ? "signature" : "file";
      const normalized = fieldMedia.map((item) => {
        if (
          item.fileKind !== expectedKind ||
          !acceptsFileType(field, item.mimeType, item.fileName)
        ) {
          throw new Error(`The uploaded content for ${field.label} is not valid.`);
        }
        const maximumMb =
          field.type === "signature"
            ? 2
            : Math.min(10, Math.max(1, field.config?.maxFileSizeMb || 5));
        if (item.fileSize < 0 || item.fileSize > maximumMb * 1024 * 1024) {
          throw new Error(`${field.label} exceeds its upload size limit.`);
        }
        usedMedia.add(item.storageObjectId);
        return {
          kind: expectedKind,
          fileId: item.id,
          ...(expectedKind === "file" ? { fileName: item.fileName, size: item.fileSize } : {}),
          mimeType: item.mimeType,
        };
      });
      canonical[field.id] = field.type === "multipleFiles" ? normalized : normalized[0];
      return;
    }

    if (missing) {
      if (isSubmissionFieldRequired(field, form, resolved)) {
        throw new Error(`Answer ${field.label} before submitting.`);
      }
      return;
    }

    validateStandardAnswer(field, value);
    if (field.type === "matrix") {
      const answer = asObject(value)!;
      canonical[field.id] = Object.fromEntries(
        (field.config?.matrixRows || []).map((row) => [row, asString(answer[row])]),
      );
    } else if (field.type === "address") {
      const answer = asObject(value)!;
      canonical[field.id] = Object.fromEntries(
        ["street", "city", "region", "postalCode", "country"]
          .map((key) => [key, asString(answer[key]).trim()])
          .filter(([, part]) => part),
      );
    } else if (field.type === "location") {
      const answer = asObject(value)!;
      canonical[field.id] = {
        latitude: Number(answer.latitude),
        longitude: Number(answer.longitude),
      };
    } else if (field.type === "product" && Array.isArray(value)) {
      canonical[field.id] = value.map((rawSelection) => {
        const selection = asObject(rawSelection)!;
        const variantId = asString(selection.variantId);
        return {
          productId: asString(selection.productId),
          ...(variantId ? { variantId } : {}),
          quantity: Math.floor(Number(selection.quantity)),
        };
      });
    } else {
      canonical[field.id] = value;
    }
  });

  if (suppliedMedia.some((item) => !usedMedia.has(item.storageObjectId))) {
    throw new Error("One or more uploaded files do not belong to a submitted field.");
  }
  return canonical;
}

const templateImagePaths: Record<string, string> = {
  "Lead & feedback": "/images/form-templates/lead-feedback.webp",
  "People & hiring": "/images/form-templates/people-hiring.webp",
  Commerce: "/images/form-templates/commerce.webp",
  "Events & ticketing": "/images/form-templates/events-ticketing.webp",
  Scheduling: "/images/form-templates/scheduling.webp",
  Operations: "/images/form-templates/operations.webp",
};

const canonicalFieldsSql = `
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'id', field.field_id,
            'type', field.field_type,
            'label', field.label,
            'placeholder', field.placeholder,
            'helpText', field.help_text,
            'required', field.required,
            'options', field.options,
            'defaultValue', field.default_value,
            'formula', field.formula,
            'width', field.width,
            'validation', field.validation,
            'config', field.config
          )
        )
        ORDER BY field.position
      )
      FROM form_fields field
      WHERE field.form_id = f.id
    ),
    '[]'::jsonb
  )`;

const canonicalSettingsSql = `
  COALESCE(
    (
      SELECT jsonb_strip_nulls(
        jsonb_build_object(
          'theme', settings.theme,
          'payment', settings.payment,
          'confirmation', settings.confirmation,
          'notifications', settings.notifications,
          'access', settings.access_control,
          'limits', settings.limits_config,
          'schedule', settings.schedule,
          'lifecycle', settings.lifecycle,
          'version', settings.current_version,
          'logic', COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', rule.rule_id,
                  'sourceFieldId', rule.source_field_id,
                  'operator', rule.operator,
                  'value', rule.comparison_value,
                  'action', rule.action,
                  'targetFieldId', rule.target_field_id
                )
                ORDER BY rule.position
              )
              FROM form_logic_rules rule
              WHERE rule.form_id = f.id
            ),
            '[]'::jsonb
          ),
          'versions', COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', version.version_id,
                  'version', version.version_number,
                  'publishedAt', version.published_at,
                  'publishedBy', version.published_by,
                  'title', version.title,
                  'description', version.description,
                  'fields', version.fields
                )
                ORDER BY version.version_number
              )
              FROM form_versions version
              WHERE version.form_id = f.id
            ),
            '[]'::jsonb
          ),
          'liveSnapshot', settings.live_snapshot,
          'hasUnpublishedChanges', settings.has_unpublished_changes,
          'archivedFromStatus', settings.archived_from_status
        )
      )
      FROM form_settings settings
      WHERE settings.form_id = f.id
    ),
    '{}'::jsonb
  )`;

const canonicalFormSelect = `
  f.id,
  f.slug,
  f.project_id,
  (SELECT project.name
   FROM projects project
   WHERE project.id = f.project_id
     AND project.created_by = f.created_by
   LIMIT 1) AS project_name,
  f.title,
  f.description,
  f.status,
  f.created_by,
  f.created_at,
  f.updated_at,
  (SELECT company.brand_color
   FROM company_settings company
   WHERE company.user_id = f.created_by
   LIMIT 1) AS workspace_brand_color,
  ${canonicalFieldsSql} AS fields,
  ${canonicalSettingsSql} AS settings,
  (SELECT COUNT(*)
   FROM form_submissions submission
   WHERE submission.form_id = f.id
     AND COALESCE(submission.data #>> '{_meta,status}', 'completed')
       <> 'pending_payment') AS response_count`;

export const normalizeFormSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

function asJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === "object") return value as T;
  return fallback;
}

const normalizeFormModulePreferences = (
  value: unknown,
  workspaceAccent?: unknown,
): FormModulePreferences => {
  const parsed = asJson<Partial<FormModulePreferences>>(value, {});
  const effectiveWorkspaceAccent = workspaceAccentColor(
    workspaceAccent ??
      (parsed.accentColorMode === "workspace"
        ? parsed.accentColor
        : DEFAULT_WORKSPACE_ACCENT),
  );
  const legacyMessage =
    asString(parsed.confirmationMessage).trim() ||
    defaultFormModulePreferences.confirmationMessage;
  const confirmation = normalizeConfirmationSettings(
    parsed.confirmation,
    {
      ...defaultFormModulePreferences.confirmation,
      message: legacyMessage,
    },
  );
  const accentColorMode =
    parsed.accentColorMode === "custom" ||
    parsed.accentColorMode === "workspace"
      ? parsed.accentColorMode
      : inferAccentColorMode(
          parsed.accentColor,
          effectiveWorkspaceAccent,
          LEGACY_FORM_ACCENTS,
        );
  const accentColor = resolveAccentColor(
    parsed.accentColor,
    effectiveWorkspaceAccent,
    accentColorMode,
    LEGACY_FORM_ACCENTS,
  );
  return {
    ...defaultFormModulePreferences,
    ...parsed,
    accentColor,
    accentColorMode,
    confirmation: {
      ...confirmation,
      accentColor: resolveAccentColor(
        confirmation.accentColor,
        effectiveWorkspaceAccent,
        accentColorMode,
        LEGACY_FORM_ACCENTS,
      ),
      useModuleDefault: false,
    },
    confirmationMessage: confirmation.message,
    accessMode:
      parsed.accessMode === "authenticated" ? "authenticated" : "public",
    notificationsEnabled:
      typeof parsed.notificationsEnabled === "boolean"
        ? parsed.notificationsEnabled
        : defaultFormModulePreferences.notificationsEnabled,
    respondentMode:
      parsed.respondentMode === "light" || parsed.respondentMode === "dark"
        ? parsed.respondentMode
        : "auto",
  };
};

export async function getFormModulePreferences(userId: string) {
  if (browserRuntime()) {
    const result = await formsDataRequest<{ preferences: unknown }>(
      "preferences",
    );
    return result.preferences == null
      ? null
      : normalizeFormModulePreferences(result.preferences);
  }
  const result = await query<{
    preferences: unknown;
    workspace_brand_color: unknown;
  }>(
    `SELECT preferences,
            (SELECT brand_color
             FROM company_settings
             WHERE user_id = $1
             LIMIT 1) AS workspace_brand_color
     FROM form_module_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  return row?.preferences == null && row?.workspace_brand_color == null
    ? null
    : normalizeFormModulePreferences(
        row?.preferences,
        row?.workspace_brand_color,
      );
}

export async function saveFormModulePreferences(
  userId: string,
  preferences: FormModulePreferences,
) {
  void userId;
  const normalized = normalizeFormModulePreferences(preferences);
  const result = await formsDataRequest<{ preferences: unknown }>(
    "preferences",
    {
      body: JSON.stringify({ preferences: normalized }),
      method: "POST",
    },
  );
  return normalizeFormModulePreferences(result.preferences);
}

export function normalizeFormTheme(
  value: unknown,
  workspaceAccent: unknown = DEFAULT_WORKSPACE_ACCENT,
): FormTheme {
  const defaults = defaultTheme();
  const parsed = asJson<Partial<FormTheme>>(value, {});
  const effectiveWorkspaceAccent = workspaceAccentColor(workspaceAccent);
  const accentColorMode =
    parsed.accentColorMode === "custom" ||
    parsed.accentColorMode === "workspace"
      ? parsed.accentColorMode
      : inferAccentColorMode(
          parsed.accentColor,
          effectiveWorkspaceAccent,
        LEGACY_FORM_ACCENTS,
        );
  const containerBorderWidth = Math.min(
    12,
    Math.max(
      0,
      typeof parsed.containerBorderWidth === "number"
        ? parsed.containerBorderWidth
        : defaults.containerBorderWidth,
    ),
  );
  const containerBorderRadius = Math.min(
    48,
    Math.max(
      0,
      typeof parsed.containerBorderRadius === "number"
        ? parsed.containerBorderRadius
        : defaults.containerBorderRadius,
    ),
  );
  const containerBorderStyle: FormTheme["containerBorderStyle"] = [
    "solid",
    "dashed",
    "dotted",
    "none",
  ].includes(parsed.containerBorderStyle || "")
    ? (parsed.containerBorderStyle as FormTheme["containerBorderStyle"])
    : defaults.containerBorderStyle;
  const pageLayout: FormTheme["pageLayout"] = [
    "standard",
    "wide",
    "full",
  ].includes(
    parsed.pageLayout || "",
  )
    ? (parsed.pageLayout as FormTheme["pageLayout"])
    : defaults.pageLayout;
  return {
    ...defaults,
    ...parsed,
    containerBorderWidth,
    containerBorderRadius,
    containerBorderStyle,
    pageLayout,
    accentColorMode,
    accentColor: resolveAccentColor(
      parsed.accentColor,
      effectiveWorkspaceAccent,
      parsed.accentColorMode || accentColorMode,
      LEGACY_FORM_ACCENTS,
    ),
    blockStyle: {
      ...defaults.blockStyle,
      ...(parsed.blockStyle || {}),
    },
    preloader: {
      ...defaults.preloader,
      ...(parsed.preloader || {}),
    },
  };
}

export function normalizeFormSettings(
  value: unknown,
  workspaceAccent: unknown = DEFAULT_WORKSPACE_ACCENT,
): FormSettings {
  const defaults = defaultFormSettings();
  const parsed = asJson<Partial<FormSettings>>(value, {});
  const effectiveWorkspaceAccent = workspaceAccentColor(workspaceAccent);
  const rawPayment = parsed.payment && typeof parsed.payment === "object"
    ? parsed.payment as Partial<FormSettings["payment"]>
    : {};
  const taxRules = Array.isArray(rawPayment.taxRules)
    ? rawPayment.taxRules.slice(0, 50).map((rule) => ({
        country: String(rule?.country || "").trim().slice(0, 80),
        region: String(rule?.region || "").trim().slice(0, 80),
        rate: Math.min(100, Math.max(0, asNumber(rule?.rate))),
      }))
    : [];
  const nonNegativeMoney = (value: unknown) =>
    Math.min(100_000_000, Math.max(0, asNumber(value)));
  const nonNegativeWeight = (value: unknown) =>
    Math.min(1_000_000_000, Math.max(0, asNumber(value)));
  const shippingMode = [
    "flat",
    "destination",
    "weight",
    "quantity",
    "advanced",
  ].includes(String(rawPayment.shippingMode))
    ? (String(rawPayment.shippingMode) as FormSettings["payment"]["shippingMode"])
    : "flat";
  const shippingRateType = ["flat", "per_item", "weight"].includes(
    String(rawPayment.shippingRateType),
  )
    ? (String(rawPayment.shippingRateType) as FormSettings["payment"]["shippingRateType"])
    : shippingMode === "quantity"
      ? "per_item"
      : shippingMode === "weight"
        ? "weight"
        : "flat";
  const shippingCountries = Array.isArray(rawPayment.shippingCountries)
    ? [...new Set(
        rawPayment.shippingCountries
          .map((country) => String(country || "").trim().slice(0, 80))
          .filter(Boolean),
      )].slice(0, 250)
    : [];
  const shippingRules = Array.isArray(rawPayment.shippingRules)
    ? rawPayment.shippingRules.slice(0, 50).map((rule) => ({
        id: String(rule?.id || "").trim().slice(0, 80) || undefined,
        name: String(rule?.name || "").trim().slice(0, 120) || undefined,
        active: rule?.active !== false,
        country: String(rule?.country || "").trim().slice(0, 80),
        countries: Array.isArray(rule?.countries)
          ? [...new Set(
              rule.countries
                .map((country) => String(country || "").trim().slice(0, 80))
                .filter(Boolean),
            )].slice(0, 250)
          : [],
        region: String(rule?.region || "").trim().slice(0, 80),
        postalCode: String(rule?.postalCode || "").trim().slice(0, 160),
        amount: nonNegativeMoney(rule?.amount),
        freeShippingThreshold: nonNegativeMoney(rule?.freeShippingThreshold),
        rateType: ["flat", "per_item", "weight"].includes(
          String(rule?.rateType),
        )
          ? (String(rule?.rateType) as "flat" | "per_item" | "weight")
          : "flat",
        perItemAmount: nonNegativeMoney(rule?.perItemAmount),
        perWeightUnitAmount: nonNegativeMoney(rule?.perWeightUnitAmount),
        handlingFee: nonNegativeMoney(rule?.handlingFee),
        minSubtotal: nonNegativeMoney(rule?.minSubtotal),
        maxSubtotal: nonNegativeMoney(rule?.maxSubtotal),
        minQuantity: Math.min(100_000, Math.max(0, Math.floor(asNumber(rule?.minQuantity)))),
        maxQuantity: Math.min(100_000, Math.max(0, Math.floor(asNumber(rule?.maxQuantity)))),
        minWeightGrams: nonNegativeWeight(rule?.minWeightGrams),
        maxWeightGrams: nonNegativeWeight(rule?.maxWeightGrams),
        deliveryEstimate: String(rule?.deliveryEstimate || "").trim().slice(0, 120),
      }))
    : [];
  return {
    ...defaults,
    ...parsed,
    logic: Array.isArray(parsed.logic) ? parsed.logic : [],
    theme: normalizeFormTheme(parsed.theme, effectiveWorkspaceAccent),
    payment: {
      ...defaultPayment(),
      ...rawPayment,
      taxMode: rawPayment.taxMode === "destination" ? "destination" : "product",
      destinationTaxRate: Math.min(
        100,
        Math.max(0, asNumber(rawPayment.destinationTaxRate)),
      ),
      taxRules,
      shippingMode,
      shippingRateType,
      shippingWeightUnit:
        rawPayment.shippingWeightUnit === "g" ||
        rawPayment.shippingWeightUnit === "lb"
          ? rawPayment.shippingWeightUnit
          : "kg",
      shippingHandlingFee: nonNegativeMoney(rawPayment.shippingHandlingFee),
      shippingPerItemAmount: nonNegativeMoney(rawPayment.shippingPerItemAmount),
      shippingPerWeightUnitAmount: nonNegativeMoney(
        rawPayment.shippingPerWeightUnitAmount,
      ),
      shippingPackageWeightGrams: nonNegativeWeight(
        rawPayment.shippingPackageWeightGrams,
      ),
      shippingCountryPolicy:
        rawPayment.shippingCountryPolicy === "allowlist" ||
        rawPayment.shippingCountryPolicy === "blocklist"
          ? rawPayment.shippingCountryPolicy
          : "worldwide",
      shippingCountries,
      shippingDefaultDeliveryEstimate: String(
        rawPayment.shippingDefaultDeliveryEstimate || "",
      )
        .trim()
        .slice(0, 120),
      shippingRules,
    },
    confirmation: (() => {
      const confirmation = normalizeConfirmationSettings(
        parsed.confirmation,
        defaults.confirmation,
        parsed.confirmation == null,
      );
      return {
        ...confirmation,
        accentColor: resolveAccentColor(
          confirmation.accentColor,
          effectiveWorkspaceAccent,
          undefined,
          LEGACY_FORM_ACCENTS,
        ),
      };
    })(),
    notifications: {
      ...defaults.notifications,
      ...(parsed.notifications || {}),
    },
    access: {
      ...defaults.access,
      ...(parsed.access || {}),
    },
    limits: {
      ...defaults.limits,
      ...(parsed.limits || {}),
    },
    schedule: {
      ...defaults.schedule,
      ...(parsed.schedule || {}),
    },
    versions: Array.isArray(parsed.versions) ? parsed.versions : [],
    liveSnapshot: parsed.liveSnapshot || null,
  };
}

export function normalizeConfirmationSettings(
  value: unknown,
  fallback = defaultFormSettings().confirmation,
  useModuleDefaultWhenMissing = false,
): FormConfirmationSettings {
  const parsed = asJson<Partial<FormConfirmationSettings>>(value, {});
  const type =
    parsed.type === "redirect" || parsed.type === "message_redirect"
      ? parsed.type
      : "message";
  const icon =
    parsed.icon === "mail" ||
    parsed.icon === "heart" ||
    parsed.icon === "none"
      ? parsed.icon
      : "check";
  return {
    ...fallback,
    ...parsed,
    useModuleDefault:
      typeof parsed.useModuleDefault === "boolean"
        ? parsed.useModuleDefault
        : useModuleDefaultWhenMissing,
    type,
    redirectDelay: Math.min(
      30,
      Math.max(0, asNumber(parsed.redirectDelay ?? fallback.redirectDelay)),
    ),
    submitButtonLabel: asString(
      parsed.submitButtonLabel ?? fallback.submitButtonLabel,
    )
      .trim()
      .slice(0, 80),
    icon,
    textAlign: parsed.textAlign === "left" ? "left" : "center",
    accentColor: asString(parsed.accentColor) || fallback.accentColor,
    backgroundColor:
      asString(parsed.backgroundColor) || fallback.backgroundColor,
  };
}

function mapForm(row: DatabaseRow): FormRecord {
  const status = asString(row.status);
  const fields = asJson<FormField[]>(row.fields, []);
  const workspaceAccent = workspaceAccentColor(row.workspace_brand_color);
  return {
    id: asString(row.id),
    slug: asString(row.slug),
    projectId: asString(row.project_id) || null,
    projectName: asString(row.project_name) || null,
    title: asString(row.title) || "Untitled form",
    description: asString(row.description),
    fields,
    settings: normalizeFormSettings(row.settings, workspaceAccent),
    status:
      status === "published" || status === "archived"
        ? status
        : ("draft" as FormStatus),
    createdBy: asString(row.created_by),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    responseCount: asNumber(row.response_count),
    fieldCount:
      row.field_count == null ? fields.length : asNumber(row.field_count),
    isSummary: asBoolean(row.is_summary),
  };
}

const mapTemplate = (row: DatabaseRow): FormTemplate => {
  const group = asString(row.group_name);
  return {
    id: asString(row.id),
    group,
    name: asString(row.name),
    description: asString(row.description),
    fields: asJson<FormField[]>(row.fields, []),
    payment: row.payment
      ? asJson<NonNullable<FormTemplate["payment"]>>(row.payment, {})
      : undefined,
    imageUrl:
      asString(row.image_path) || templateImagePaths[group] || undefined,
  };
};

export async function loadFormModuleBootstrap(userId: string) {
  void userId;
  const result = await formsDataRequest<{
    forms: DatabaseRow[];
  }>("bootstrap");
  return {
    forms: result.forms.map(mapForm),
    templates: builtInFormTemplates.map((template) => ({
      ...template,
      imageUrl: templateImagePaths[template.group],
    })),
  };
}

export async function loadPersistedFormTemplates() {
  const result = await formsDataRequest<{ rows: DatabaseRow[] }>("templates");
  return result.rows.length > 0
    ? result.rows.map(mapTemplate)
    : builtInFormTemplates.map((template) => ({
        ...template,
        imageUrl: templateImagePaths[template.group],
      }));
}

export async function loadWorkspaceFormAnalytics(
  userId: string,
): Promise<WorkspaceFormAnalytics> {
  void userId;
  const result = await formsDataRequest<{
    analytics: WorkspaceFormAnalytics;
  }>("analytics");
  return result.analytics;
}

async function createUniqueFormSlug(title: string) {
  const base = normalizeFormSlug(title) || "form";
  const result = await query(
    `SELECT slug
     FROM forms
     WHERE slug = $1 OR slug LIKE $2`,
    [base, `${base}-%`],
  );
  const used = new Set(
    result.rows.map((row) => asString((row as DatabaseRow).slug)),
  );
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

const workspaceAccentFor = async (userId: string) => {
  const result = await query<{ brand_color: unknown }>(
    `SELECT brand_color
     FROM company_settings
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  return workspaceAccentColor(result.rows[0]?.brand_color);
};

export async function isFormSlugAvailable(slug: string, formId = "") {
  if (browserRuntime()) {
    return formsRpc<boolean>("isFormSlugAvailable", { slug, formId });
  }
  const normalized = normalizeFormSlug(slug);
  if (!normalized || normalized !== slug || normalized.length < 3) {
    return false;
  }
  const result = await query(
    `SELECT id
     FROM forms
     WHERE slug = $1
       AND id::text <> $2
     LIMIT 1`,
    [normalized, formId],
  );
  return result.rows.length === 0;
}

export async function listWorkspaceForms(
  userId: string,
  options: { includeEventRegistrationForms?: boolean } = {},
) {
  if (browserRuntime()) {
    const result = await formsDataRequest<{ rows: DatabaseRow[] }>(
      "forms",
      {},
      {
        includeEventRegistrationForms: String(
          Boolean(options.includeEventRegistrationForms),
        ),
      },
    );
    return result.rows.map((row) => mapForm(row as DatabaseRow));
  }
  const result = await query(
    `SELECT ${canonicalFormSelect}
     FROM forms f
     WHERE f.created_by = $1
       AND (
         $2::boolean
         OR NOT EXISTS (
           SELECT 1
           FROM events event
           WHERE event.registration_form_id = f.id
         )
       )
     ORDER BY f.updated_at DESC`,
    [userId, Boolean(options.includeEventRegistrationForms)],
  );
  return result.rows.map((row) => mapForm(row as DatabaseRow));
}

async function getWorkspaceFormById(userId: string, formId: string) {
  const result = await query(
    `SELECT ${canonicalFormSelect}
     FROM forms f
     WHERE f.id = $1 AND f.created_by = $2
     LIMIT 1`,
    [formId, userId],
  );
  return result.rows[0] ? mapForm(result.rows[0] as DatabaseRow) : null;
}

export async function createWorkspaceForm(
  userId: string,
  input: {
    title: string;
    description?: string;
    fields?: FormField[];
    settings?: FormSettings;
    /** Set when the form is created from inside a project. */
    projectId?: string | null;
  },
) {
  if (browserRuntime()) {
    return formsRpc<FormRecord>("createWorkspaceForm", { input });
  }
  const workspaceAccent = await workspaceAccentFor(userId);
  const settings = normalizeFormSettings(
    input.settings || defaultFormSettings(),
    workspaceAccent,
  );
  const slug = await createUniqueFormSlug(input.title);
  // The project is only honored when the caller owns it, so a crafted request
  // cannot file a form into someone else's folder.
  const result = await query(
    `INSERT INTO forms (
       title, slug, description, fields, settings, status, project_id,
       created_by, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4::jsonb, $5::jsonb, 'draft',
       (SELECT id FROM projects WHERE id = $7::uuid AND created_by = $6),
       $6, NOW(), NOW()
     )
     RETURNING *`,
    [
      input.title,
      slug,
      input.description || null,
      JSON.stringify(input.fields || []),
      JSON.stringify(settings),
      userId,
      input.projectId || null,
    ],
  );
  const created = mapForm({
    ...(result.rows[0] as DatabaseRow),
    response_count: 0,
  });
  return saveWorkspaceForm(userId, created);
}

export async function createFormFromTemplate(
  userId: string,
  template: FormTemplate,
  baseSettings: FormSettings = defaultFormSettings(),
  projectId: string | null = null,
) {
  const settings = structuredClone(baseSettings);
  if (template.payment) {
    settings.payment = {
      ...settings.payment,
      ...template.payment,
    };
  }
  return createWorkspaceForm(userId, {
    title: template.name,
    description: template.description,
    fields: cloneTemplateFields(template.fields),
    projectId,
    settings,
  });
}

export async function listFormTemplates() {
  if (browserRuntime()) {
    return loadPersistedFormTemplates();
  }
  let result = await query(
    `SELECT template.id,
       template.group_name,
       template.name,
       template.description,
       template.payment,
       template.image_path,
       COALESCE(
         jsonb_agg(
           jsonb_strip_nulls(
             jsonb_build_object(
               'id', template.id || '-field-' || field.position::text,
               'type', field.field_type,
               'label', field.label,
               'placeholder', field.placeholder,
               'helpText', field.help_text,
               'required', field.required,
               'options', field.options,
               'defaultValue', field.default_value,
               'formula', field.formula,
               'width', field.width,
               'validation', field.validation,
               'config', field.config
             )
           )
           ORDER BY field.position
         ) FILTER (WHERE field.template_id IS NOT NULL),
         '[]'::jsonb
       ) AS fields
     FROM form_templates template
     LEFT JOIN form_template_fields field ON field.template_id = template.id
     WHERE template.active = TRUE
     GROUP BY template.id
     ORDER BY template.sort_order, template.name`,
  );

  if (result.rows.length === 0) {
    const seed = builtInFormTemplates.map((template, sortOrder) => ({
      ...template,
      imagePath: templateImagePaths[template.group] || null,
      sortOrder,
    }));
    await query(
      `WITH input AS (
         SELECT $1::jsonb AS value
       ),
       saved_templates AS (
         INSERT INTO form_templates (
           id, group_name, name, description, payment, image_path, active, sort_order, updated_at
         )
         SELECT template->>'id',
           template->>'group',
           template->>'name',
           COALESCE(template->>'description', ''),
           template->'payment',
           template->>'imagePath',
           TRUE,
           (template->>'sortOrder')::integer,
           NOW()
         FROM input
         CROSS JOIN LATERAL jsonb_array_elements(input.value) template
         ON CONFLICT (id)
         DO UPDATE SET
           group_name = EXCLUDED.group_name,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           payment = EXCLUDED.payment,
           image_path = EXCLUDED.image_path,
           active = TRUE,
           sort_order = EXCLUDED.sort_order,
           updated_at = NOW()
         RETURNING id
       )
       INSERT INTO form_template_fields (
         template_id, position, field_type, label, placeholder, help_text,
         required, options, default_value, formula, width, validation, config
       )
       SELECT template->>'id',
         (field.ordinality - 1)::integer,
         field.value->>'type',
         COALESCE(field.value->>'label', ''),
         field.value->>'placeholder',
         field.value->>'helpText',
         COALESCE((field.value->>'required')::boolean, FALSE),
         field.value->'options',
         field.value->>'defaultValue',
         field.value->>'formula',
         field.value->>'width',
         field.value->'validation',
         COALESCE(field.value->'config', '{}'::jsonb)
       FROM input
       CROSS JOIN LATERAL jsonb_array_elements(input.value) template
       CROSS JOIN LATERAL jsonb_array_elements(
         COALESCE(template->'fields', '[]'::jsonb)
       ) WITH ORDINALITY field(value, ordinality)
       JOIN saved_templates saved ON saved.id = template->>'id'
       ON CONFLICT (template_id, position)
       DO UPDATE SET
         field_type = EXCLUDED.field_type,
         label = EXCLUDED.label,
         placeholder = EXCLUDED.placeholder,
         help_text = EXCLUDED.help_text,
         required = EXCLUDED.required,
         options = EXCLUDED.options,
         default_value = EXCLUDED.default_value,
         formula = EXCLUDED.formula,
         width = EXCLUDED.width,
         validation = EXCLUDED.validation,
         config = EXCLUDED.config`,
      [JSON.stringify(seed)],
    );
    result = await query(
      `SELECT template.id,
         template.group_name,
         template.name,
         template.description,
         template.payment,
         template.image_path,
         COALESCE(
           jsonb_agg(
             jsonb_strip_nulls(
               jsonb_build_object(
                 'id', template.id || '-field-' || field.position::text,
                 'type', field.field_type,
                 'label', field.label,
                 'placeholder', field.placeholder,
                 'helpText', field.help_text,
                 'required', field.required,
                 'options', field.options,
                 'defaultValue', field.default_value,
                 'formula', field.formula,
                 'width', field.width,
                 'validation', field.validation,
                 'config', field.config
               )
             )
             ORDER BY field.position
           ) FILTER (WHERE field.template_id IS NOT NULL),
           '[]'::jsonb
         ) AS fields
       FROM form_templates template
       LEFT JOIN form_template_fields field ON field.template_id = template.id
       WHERE template.active = TRUE
       GROUP BY template.id
       ORDER BY template.sort_order, template.name`,
    );
  }

  return result.rows.map((row) => {
    const item = row as DatabaseRow;
    return {
      id: asString(item.id),
      group: asString(item.group_name),
      name: asString(item.name),
      description: asString(item.description),
      fields: asJson<FormField[]>(item.fields, []),
      payment: item.payment
        ? asJson<NonNullable<FormTemplate["payment"]>>(item.payment, {})
        : undefined,
      imageUrl: asString(item.image_path) || undefined,
    } satisfies FormTemplate;
  });
}

export async function saveWorkspaceForm(
  userId: string,
  form: FormRecord,
) {
  if (browserRuntime()) {
    return formsRpc<FormRecord>("saveWorkspaceForm", { form });
  }
  const workspaceAccent = await workspaceAccentFor(userId);
  const normalized = {
    title: form.title.trim() || "Untitled form",
    slug: normalizeFormSlug(form.slug),
    description: form.description || "",
    fields: form.fields,
    settings: normalizeFormSettings(form.settings, workspaceAccent),
    status: form.status,
  };
  const payment = normalized.settings.payment;
  const isPublishing =
    normalized.status === "published" &&
    normalized.settings.hasUnpublishedChanges === false;
  // The editor has already validated payment configuration for a live update.
  // Rechecking it through the payments API adds one or more network round
  // trips to every Update click. Keep the server-side check for the first
  // publication, when a form has no established live version yet.
  const isFirstPublication = normalized.settings.version <= 1;
  if (isPublishing && isFirstPublication && payment.enabled) {
    const [providerConnected, products] = await Promise.all([
      paymentProviderConnected(userId, payment.provider),
      payment.mode === "product" || payment.mode === "cart"
        ? paymentProductsForWorkspace(userId)
        : Promise.resolve([]),
    ]);
    if (!providerConnected) {
      throw new Error(
        "Connect a healthy payment provider before publishing this form.",
      );
    }
    if (payment.mode === "product") {
      const product = products.find((item) => item.id === payment.productId);
      if (!product) {
        throw new Error(
          "Choose an active payment product before publishing this form.",
        );
      }
      if (product.billingType === "recurring") {
        if (
          !(await paymentProviderConnected(
            userId,
            payment.provider,
            true,
          ))
        ) {
          throw new Error(
            "Recurring products require Stripe, PayPal, or Paystack.",
          );
        }
      }
    }
    if (payment.mode === "cart") {
      const productIds = [...new Set(
        normalized.fields
          .filter((field) => field.type === "product")
          .flatMap((field) => field.config?.productIds || []),
      )];
      const cartProducts = productIds
        .map((productId) => products.find((product) => product.id === productId))
        .filter((product): product is (typeof products)[number] => Boolean(product));
      if (productIds.length === 0 || cartProducts.length !== productIds.length) {
        throw new Error("Add at least one active catalog product to a Product field before publishing.");
      }
      if (cartProducts.some((product) => product.billingType !== "one_time")) {
        throw new Error("A form cart can only contain one-time products.");
      }
      if (new Set(cartProducts.map((product) => product.currency)).size !== 1) {
        throw new Error("Every product in a form cart must use the same currency.");
      }
    }
  }
  const result = await query(
    `WITH input AS (
       SELECT $1::jsonb AS value
     ),
     updated_form AS (
       UPDATE forms form
       SET title = input.value->>'title',
           slug = input.value->>'slug',
           description = NULLIF(input.value->>'description', ''),
           fields = input.value->'fields',
           settings = input.value->'settings',
           status = input.value->>'status',
           updated_at = NOW()
       FROM input
       WHERE form.id = $2
         AND form.created_by = $3
       RETURNING form.id
     ),
     saved_fields AS (
       INSERT INTO form_fields (
         form_id, field_id, position, field_type, label, placeholder,
         help_text, required, options, default_value, formula, width,
         validation, config, updated_at
       )
       SELECT updated_form.id,
         field.value->>'id',
         (field.ordinality - 1)::integer,
         field.value->>'type',
         COALESCE(field.value->>'label', ''),
         field.value->>'placeholder',
         field.value->>'helpText',
         COALESCE((field.value->>'required')::boolean, FALSE),
         field.value->'options',
         field.value->>'defaultValue',
         field.value->>'formula',
         field.value->>'width',
         field.value->'validation',
         COALESCE(field.value->'config', '{}'::jsonb),
         NOW()
       FROM input
       CROSS JOIN updated_form
       CROSS JOIN LATERAL jsonb_array_elements(
         COALESCE(input.value->'fields', '[]'::jsonb)
       ) WITH ORDINALITY field(value, ordinality)
       ON CONFLICT (form_id, field_id)
       DO UPDATE SET
         position = EXCLUDED.position,
         field_type = EXCLUDED.field_type,
         label = EXCLUDED.label,
         placeholder = EXCLUDED.placeholder,
         help_text = EXCLUDED.help_text,
         required = EXCLUDED.required,
         options = EXCLUDED.options,
         default_value = EXCLUDED.default_value,
         formula = EXCLUDED.formula,
         width = EXCLUDED.width,
         validation = EXCLUDED.validation,
         config = EXCLUDED.config,
         updated_at = NOW()
       RETURNING form_id, field_id
     ),
     removed_fields AS (
       DELETE FROM form_fields field
       USING input, updated_form
       WHERE field.form_id = updated_form.id
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             COALESCE(input.value->'fields', '[]'::jsonb)
           ) current_field
           WHERE current_field->>'id' = field.field_id
         )
       RETURNING field.form_id
     ),
     saved_settings AS (
       INSERT INTO form_settings (
         form_id, theme, payment, confirmation, notifications, access_control,
         limits_config, schedule, lifecycle, current_version, live_snapshot,
         has_unpublished_changes, archived_from_status, updated_at
       )
       SELECT updated_form.id,
         COALESCE(input.value->'settings'->'theme', '{}'::jsonb),
         COALESCE(input.value->'settings'->'payment', '{}'::jsonb),
         COALESCE(input.value->'settings'->'confirmation', '{}'::jsonb),
         COALESCE(input.value->'settings'->'notifications', '{}'::jsonb),
         COALESCE(input.value->'settings'->'access', '{}'::jsonb),
         COALESCE(input.value->'settings'->'limits', '{}'::jsonb),
         COALESCE(input.value->'settings'->'schedule', '{}'::jsonb),
         COALESCE(NULLIF(input.value->'settings'->>'lifecycle', ''), 'active'),
         COALESCE((input.value->'settings'->>'version')::integer, 0),
         NULLIF(input.value->'settings'->'liveSnapshot', 'null'::jsonb),
         COALESCE(
           (input.value->'settings'->>'hasUnpublishedChanges')::boolean,
           FALSE
         ),
         NULLIF(input.value->'settings'->>'archivedFromStatus', ''),
         NOW()
       FROM input
       CROSS JOIN updated_form
       ON CONFLICT (form_id)
       DO UPDATE SET
         theme = EXCLUDED.theme,
         payment = EXCLUDED.payment,
         confirmation = EXCLUDED.confirmation,
         notifications = EXCLUDED.notifications,
         access_control = EXCLUDED.access_control,
         limits_config = EXCLUDED.limits_config,
         schedule = EXCLUDED.schedule,
         lifecycle = EXCLUDED.lifecycle,
         current_version = EXCLUDED.current_version,
         live_snapshot = EXCLUDED.live_snapshot,
         has_unpublished_changes = EXCLUDED.has_unpublished_changes,
         archived_from_status = EXCLUDED.archived_from_status,
         updated_at = NOW()
       RETURNING form_id
     ),
     saved_logic AS (
       INSERT INTO form_logic_rules (
         form_id, rule_id, position, source_field_id, operator,
         comparison_value, action, target_field_id, updated_at
       )
       SELECT updated_form.id,
         rule.value->>'id',
         (rule.ordinality - 1)::integer,
         rule.value->>'sourceFieldId',
         rule.value->>'operator',
         COALESCE(rule.value->>'value', ''),
         rule.value->>'action',
         rule.value->>'targetFieldId',
         NOW()
       FROM input
       CROSS JOIN updated_form
       CROSS JOIN LATERAL jsonb_array_elements(
         COALESCE(input.value->'settings'->'logic', '[]'::jsonb)
       ) WITH ORDINALITY rule(value, ordinality)
       ON CONFLICT (form_id, rule_id)
       DO UPDATE SET
         position = EXCLUDED.position,
         source_field_id = EXCLUDED.source_field_id,
         operator = EXCLUDED.operator,
         comparison_value = EXCLUDED.comparison_value,
         action = EXCLUDED.action,
         target_field_id = EXCLUDED.target_field_id,
         updated_at = NOW()
       RETURNING form_id, rule_id
     ),
     removed_logic AS (
       DELETE FROM form_logic_rules rule
       USING input, updated_form
       WHERE rule.form_id = updated_form.id
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             COALESCE(input.value->'settings'->'logic', '[]'::jsonb)
           ) current_rule
           WHERE current_rule->>'id' = rule.rule_id
         )
       RETURNING rule.form_id
     ),
     saved_versions AS (
       INSERT INTO form_versions (
         form_id, version_id, version_number, published_at, published_by,
         title, description, fields
       )
       SELECT updated_form.id,
         version.value->>'id',
         (version.value->>'version')::integer,
         (version.value->>'publishedAt')::timestamptz,
         COALESCE(version.value->>'publishedBy', ''),
         COALESCE(version.value->>'title', input.value->>'title'),
         COALESCE(version.value->>'description', ''),
         COALESCE(version.value->'fields', '[]'::jsonb)
       FROM input
       CROSS JOIN updated_form
       CROSS JOIN LATERAL jsonb_array_elements(
         COALESCE(input.value->'settings'->'versions', '[]'::jsonb)
       ) version
       ON CONFLICT (form_id, version_id)
       DO UPDATE SET
         version_number = EXCLUDED.version_number,
         published_at = EXCLUDED.published_at,
         published_by = EXCLUDED.published_by,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         fields = EXCLUDED.fields
       RETURNING form_id, version_id
     ),
     removed_versions AS (
       DELETE FROM form_versions version
       USING input, updated_form
       WHERE version.form_id = updated_form.id
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             COALESCE(input.value->'settings'->'versions', '[]'::jsonb)
           ) current_version
           WHERE current_version->>'id' = version.version_id
         )
       RETURNING version.form_id
     )
     SELECT id FROM updated_form`,
    [JSON.stringify(normalized), form.id, userId],
  );
  if (!result.rows[0]) throw new Error("Form was not found");
  return {
    ...form,
    ...normalized,
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteWorkspaceForm(userId: string, formId: string) {
  if (browserRuntime()) {
    return formsRpc<void>("deleteWorkspaceForm", { formId });
  }
  const storedObjects = await query<{ storage_object_id: string }>(
    `SELECT DISTINCT upload.storage_object_id
     FROM form_submission_files upload
     WHERE upload.form_id = $1
       AND upload.storage_object_id IS NOT NULL`,
    [formId],
  );
  await query("DELETE FROM forms WHERE id = $1 AND created_by = $2", [
    formId,
    userId,
  ]);
  await Promise.allSettled(
    storedObjects.rows.map((row) =>
      removeStoredObject(userId, asString(row.storage_object_id)),
    ),
  );
}

export async function listFormSubmissions(
  userId: string,
  formId: string,
) {
  if (browserRuntime()) {
    return formsRpc<FormSubmission[]>("listFormSubmissions", { formId });
  }
  const result = await query(
    `SELECT s.id,
       s.form_id,
       s.submitted_by,
       s.submitted_at,
       s.ip_address,
       s.user_agent,
       COALESCE(
         (
           SELECT jsonb_object_agg(
             answer.field_id,
             CASE
               WHEN jsonb_typeof(answer.answer) = 'array' THEN
                 COALESCE(
                   (
                     SELECT jsonb_agg(
                       item.value || jsonb_strip_nulls(jsonb_build_object(
                         'fileName', upload.file_name,
                         'mimeType', upload.mime_type,
                         'size', upload.file_size,
                         'storageObjectId', upload.storage_object_id
                       ))
                       ORDER BY item.ordinality
                     )
                     FROM jsonb_array_elements(answer.answer)
                       WITH ORDINALITY item(value, ordinality)
                     LEFT JOIN form_submission_files upload
                       ON upload.submission_id = answer.submission_id
                      AND upload.field_id = answer.field_id
                      AND upload.id::text = item.value->>'fileId'
                   ),
                   answer.answer
                 )
               WHEN file.id IS NOT NULL THEN
                 answer.answer || jsonb_build_object(
                   'fileName', file.file_name,
                   'mimeType', file.mime_type,
                   'size', file.file_size,
                   'storageObjectId', file.storage_object_id
                 )
               ELSE answer.answer
             END
           )
           FROM form_submission_answers answer
           LEFT JOIN LATERAL (
             SELECT upload.*
             FROM form_submission_files upload
             WHERE upload.submission_id = answer.submission_id
               AND upload.field_id = answer.field_id
               AND upload.id::text = answer.answer->>'fileId'
             LIMIT 1
           ) file ON TRUE
           WHERE answer.submission_id = s.id
         ),
         '{}'::jsonb
       ) ||
       CASE
         WHEN s.data ? '_meta'
         THEN jsonb_build_object('_meta', s.data->'_meta')
         ELSE '{}'::jsonb
       END AS data
     FROM form_submissions s
     JOIN forms f ON f.id = s.form_id
     WHERE s.form_id = $1
       AND f.created_by = $2
       AND COALESCE(s.data #>> '{_meta,status}', 'completed')
         <> 'pending_payment'
     ORDER BY s.submitted_at DESC`,
    [formId, userId],
  );
  const submissions = result.rows.map((row) => {
    const item = row as DatabaseRow;
    return {
      id: asString(item.id),
      formId: asString(item.form_id),
      data: asJson<Record<string, unknown>>(item.data, {}),
      submittedBy: asString(item.submitted_by) || null,
      submittedAt: asString(item.submitted_at),
      ipAddress: asString(item.ip_address) || null,
      userAgent: asString(item.user_agent) || null,
    } satisfies FormSubmission;
  });
  const objectIds = submissions.flatMap((submission) =>
    Object.values(submission.data)
      .flatMap((value) =>
        Array.isArray(value)
          ? value.map((item) => asString(asObject(item)?.storageObjectId))
          : [asString(asObject(value)?.storageObjectId)],
      )
      .filter(Boolean),
  );
  if (objectIds.length === 0) return submissions;
  const access = await storedObjectAccessBatch(userId, objectIds);
  const urls = new Map(access.map((item) => [item.object.id, item.url]));
  return submissions.map((submission) => ({
    ...submission,
    data: Object.fromEntries(
      Object.entries(submission.data).map(([fieldId, value]) => {
        if (Array.isArray(value)) {
          return [
            fieldId,
            value.map((item) => {
              const answer = asObject(item);
              const url = urls.get(asString(answer?.storageObjectId));
              return answer && url ? { ...answer, url } : item;
            }),
          ];
        }
        const answer = asObject(value);
        const storageObjectId = asString(answer?.storageObjectId);
        const url = urls.get(storageObjectId);
        return [
          fieldId,
          answer && url ? { ...answer, url } : value,
        ];
      }),
    ),
  }));
}

export async function updateFormSubmission(
  userId: string,
  submission: FormSubmission,
) {
  if (browserRuntime()) {
    return formsRpc<FormSubmission>("updateFormSubmission", { submission });
  }
  await query(
    `WITH input AS (
       SELECT $1::jsonb AS value
     ),
     updated_submission AS (
       UPDATE form_submissions submission
       SET data = input.value
       FROM forms form, input
       WHERE submission.form_id = form.id
         AND submission.id = $2
         AND form.created_by = $3
       RETURNING submission.id
     ),
     saved_answers AS (
       INSERT INTO form_submission_answers (
         submission_id, field_id, answer, updated_at
       )
       SELECT updated_submission.id, answer.key, answer.value, NOW()
       FROM input
       CROSS JOIN updated_submission
       CROSS JOIN LATERAL jsonb_each(input.value) answer(key, value)
       WHERE answer.key <> '_meta'
       ON CONFLICT (submission_id, field_id)
       DO UPDATE SET answer = EXCLUDED.answer, updated_at = NOW()
       RETURNING submission_id, field_id
     )
     DELETE FROM form_submission_answers answer
     USING input, updated_submission
     WHERE answer.submission_id = updated_submission.id
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_each(input.value) current_answer(key, value)
         WHERE current_answer.key <> '_meta'
           AND current_answer.key = answer.field_id
       )`,
    [JSON.stringify(submission.data), submission.id, userId],
  );
}

export async function deleteFormSubmissions(
  userId: string,
  formId: string,
  submissionIds: string[],
) {
  if (browserRuntime()) {
    return formsRpc<void>("deleteFormSubmissions", {
      formId,
      submissionIds,
    });
  }
  const storedObjects = await query<{ storage_object_id: string }>(
    `SELECT DISTINCT upload.storage_object_id
     FROM form_submission_files upload
     JOIN forms form ON form.id = upload.form_id
     WHERE upload.submission_id = ANY($1::uuid[])
       AND upload.form_id = $2
       AND form.created_by = $3
       AND upload.storage_object_id IS NOT NULL`,
    [submissionIds, formId, userId],
  );
  await Promise.all(
    submissionIds.map((submissionId) =>
      query(
        `DELETE FROM form_submissions s
         USING forms f
         WHERE s.form_id = f.id
           AND s.id = $1
           AND s.form_id = $2
           AND f.created_by = $3`,
        [submissionId, formId, userId],
      ),
    ),
  );
  await Promise.allSettled(
    storedObjects.rows.map((row) =>
      removeStoredObject(userId, asString(row.storage_object_id)),
    ),
  );
}

export async function listFormPayments(
  userId: string,
  formId: string,
) {
  const rows = await secureFormPayments(userId, formId);
  return rows.map((row) => {
    const item = row as DatabaseRow;
    return {
      id: asString(item.id),
      submissionId: asString(item.submission_id),
      amount: asNumber(item.amount),
      currency: asString(item.currency) || "USD",
      provider: asString(item.provider),
      status: asString(item.status),
      paymentDate: asString(item.payment_date),
    } satisfies FormPayment;
  });
}

export async function listFormWorkflows(userId: string, formId: string) {
  if (browserRuntime()) {
    return formsRpc<FormWorkflow[]>("listFormWorkflows", { formId });
  }
  const result = await query(
    `SELECT workflow.id,
       workflow.form_id,
       workflow.name,
       workflow.description,
       workflow.trigger_event,
       workflow.enabled,
       workflow.run_once_per_submission,
       workflow.project_id,
       workflow.created_at,
       workflow.updated_at,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', action.id,
               'type', action.action_type,
               'name', action.name,
               'connectionId', action.connection_id,
               'config', action.configuration,
               'enabled', action.enabled
             )
             ORDER BY action.position
           )
           FROM workflow_actions action
           WHERE action.workflow_id = workflow.id
         ),
         '[]'::jsonb
       ) AS actions,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', condition.id,
               'fieldId', condition.field_id,
               'operator', condition.operator,
               'value', condition.comparison_value
             )
             ORDER BY condition.position
           )
           FROM workflow_conditions condition
           WHERE condition.workflow_id = workflow.id
         ),
         '[]'::jsonb
       ) AS conditions,
       (
         SELECT COUNT(*)
         FROM automation_runs run
         WHERE run.workflow_id = workflow.id
       ) AS run_count,
       (
         SELECT COUNT(*)
         FROM automation_runs run
         WHERE run.workflow_id = workflow.id AND run.status = 'succeeded'
       ) AS success_count,
       (
         SELECT COUNT(*)
         FROM automation_runs run
         WHERE run.workflow_id = workflow.id AND run.status = 'failed'
       ) AS failure_count,
       (
         SELECT run.created_at
         FROM automation_runs run
         WHERE run.workflow_id = workflow.id
         ORDER BY run.created_at DESC
         LIMIT 1
       ) AS last_run_at,
       (
         SELECT run.status
         FROM automation_runs run
         WHERE run.workflow_id = workflow.id
         ORDER BY run.created_at DESC
         LIMIT 1
       ) AS last_run_status
     FROM workflows workflow
     JOIN forms form ON form.id = workflow.form_id
     WHERE workflow.form_id = $1 AND form.created_by = $2
     ORDER BY workflow.updated_at DESC`,
    [formId, userId],
  );
  return result.rows.map((row) => mapFormWorkflow(row as DatabaseRow));
}

function mapFormWorkflow(item: DatabaseRow): FormWorkflow {
  const lastRunStatus = asString(item.last_run_status);
  return {
    id: asString(item.id),
    formId: asString(item.form_id),
    projectId: asString(item.project_id) || null,
    name: asString(item.name),
    description: asString(item.description),
    triggerEvent:
      asString(item.trigger_event) === "response_completed" ||
      asString(item.trigger_event) === "response_partial" ||
      asString(item.trigger_event) === "payment_completed"
        ? (asString(item.trigger_event) as FormWorkflow["triggerEvent"])
        : "form_submitted",
    actions: asJson<AutomationAction[]>(item.actions, []),
    conditions: asJson<AutomationCondition[]>(item.conditions, []),
    enabled: asBoolean(item.enabled),
    runOncePerSubmission:
      item.run_once_per_submission == null
        ? true
        : asBoolean(item.run_once_per_submission),
    runCount: asNumber(item.run_count),
    successCount: asNumber(item.success_count),
    failureCount: asNumber(item.failure_count),
    lastRunAt: asString(item.last_run_at) || null,
    lastRunStatus:
      lastRunStatus === "queued" ||
      lastRunStatus === "running" ||
      lastRunStatus === "succeeded" ||
      lastRunStatus === "failed" ||
      lastRunStatus === "skipped"
        ? lastRunStatus
        : null,
    createdAt: asString(item.created_at),
    updatedAt: asString(item.updated_at),
  };
}

async function getFormWorkflow(
  userId: string,
  formId: string,
  workflowId: string,
) {
  const workflows = await listFormWorkflows(userId, formId);
  return workflows.find((workflow) => workflow.id === workflowId) || null;
}

export async function createFormWorkflow(
  userId: string,
  formId: string,
  input: AutomationWorkflowInput,
) {
  if (browserRuntime()) {
    return formsRpc<FormWorkflow>("createFormWorkflow", { formId, input });
  }
  const payload = {
    ...input,
    actions: input.actions.map((action) => ({
      ...action,
      id: action.id || crypto.randomUUID(),
    })),
    conditions: input.conditions.map((condition) => ({
      ...condition,
      id: condition.id || crypto.randomUUID(),
    })),
  };
  const result = await query(
    `WITH input AS (
       SELECT $1::jsonb AS value
     ),
     authorized_form AS (
       SELECT form.id
       FROM forms form
       WHERE form.id = $2 AND form.created_by = $3
     ),
     saved_workflow AS (
       INSERT INTO workflows (
         form_id, name, description, trigger_event, actions, enabled,
         run_once_per_submission, created_by, created_at, updated_at
       )
       SELECT authorized_form.id,
         input.value->>'name',
         COALESCE(input.value->>'description', ''),
         input.value->>'triggerEvent',
         COALESCE(input.value->'actions', '[]'::jsonb),
         COALESCE((input.value->>'enabled')::boolean, TRUE),
         COALESCE(
           (input.value->>'runOncePerSubmission')::boolean,
           TRUE
         ),
         $3,
         NOW(),
         NOW()
       FROM input
       CROSS JOIN authorized_form
       RETURNING id
     ),
     saved_actions AS (
       INSERT INTO workflow_actions (
         id, workflow_id, position, action_type, name, connection_id,
         configuration, enabled, updated_at
       )
       SELECT (action.value->>'id')::uuid,
         saved_workflow.id,
         (action.ordinality - 1)::integer,
         action.value->>'type',
         COALESCE(action.value->>'name', 'Action'),
         NULLIF(action.value->>'connectionId', '')::uuid,
         COALESCE(action.value->'config', '{}'::jsonb),
         COALESCE((action.value->>'enabled')::boolean, TRUE),
         NOW()
       FROM input
       CROSS JOIN saved_workflow
       CROSS JOIN LATERAL jsonb_array_elements(
         COALESCE(input.value->'actions', '[]'::jsonb)
       ) WITH ORDINALITY action(value, ordinality)
       RETURNING workflow_id
     ),
     saved_conditions AS (
       INSERT INTO workflow_conditions (
         id, workflow_id, position, field_id, operator, comparison_value,
         updated_at
       )
       SELECT (condition.value->>'id')::uuid,
         saved_workflow.id,
         (condition.ordinality - 1)::integer,
         condition.value->>'fieldId',
         condition.value->>'operator',
         COALESCE(condition.value->>'value', ''),
         NOW()
       FROM input
       CROSS JOIN saved_workflow
       CROSS JOIN LATERAL jsonb_array_elements(
         COALESCE(input.value->'conditions', '[]'::jsonb)
       ) WITH ORDINALITY condition(value, ordinality)
       RETURNING workflow_id
     )
     SELECT id FROM saved_workflow`,
    [JSON.stringify(payload), formId, userId],
  );
  if (!result.rows[0]) throw new Error("Form was not found");
  const workflowId = asString((result.rows[0] as DatabaseRow).id);
  const saved = await getFormWorkflow(userId, formId, workflowId);
  if (!saved) throw new Error("Automation could not be reloaded");
  return saved;
}

export async function updateFormWorkflow(
  userId: string,
  formId: string,
  workflowId: string,
  input: AutomationWorkflowInput,
) {
  if (browserRuntime()) {
    return formsRpc<FormWorkflow>("updateFormWorkflow", {
      formId,
      workflowId,
      input,
    });
  }
  const result = await query(
    `WITH input AS (
       SELECT $1::jsonb AS value
     ),
     saved_workflow AS (
       UPDATE workflows workflow
       SET name = input.value->>'name',
           description = COALESCE(input.value->>'description', ''),
           trigger_event = input.value->>'triggerEvent',
           actions = COALESCE(input.value->'actions', '[]'::jsonb),
           enabled = COALESCE((input.value->>'enabled')::boolean, TRUE),
           run_once_per_submission = COALESCE(
             (input.value->>'runOncePerSubmission')::boolean,
             TRUE
           ),
           updated_at = NOW()
       FROM forms form, input
       WHERE workflow.form_id = form.id
         AND workflow.id = $2
         AND workflow.form_id = $3
         AND form.created_by = $4
       RETURNING workflow.id
     ),
     saved_actions AS (
       INSERT INTO workflow_actions (
         id, workflow_id, position, action_type, name, connection_id,
         configuration, enabled, updated_at
       )
       SELECT (action.value->>'id')::uuid,
         saved_workflow.id,
         (action.ordinality - 1)::integer,
         action.value->>'type',
         COALESCE(action.value->>'name', 'Action'),
         NULLIF(action.value->>'connectionId', '')::uuid,
         COALESCE(action.value->'config', '{}'::jsonb),
         COALESCE((action.value->>'enabled')::boolean, TRUE),
         NOW()
       FROM input
       CROSS JOIN saved_workflow
       CROSS JOIN LATERAL jsonb_array_elements(
         COALESCE(input.value->'actions', '[]'::jsonb)
       ) WITH ORDINALITY action(value, ordinality)
       ON CONFLICT (id)
       DO UPDATE SET
         position = EXCLUDED.position,
         action_type = EXCLUDED.action_type,
         name = EXCLUDED.name,
         connection_id = EXCLUDED.connection_id,
         configuration = EXCLUDED.configuration,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()
       RETURNING workflow_id, id
     ),
     removed_actions AS (
       DELETE FROM workflow_actions action
       USING input, saved_workflow
       WHERE action.workflow_id = saved_workflow.id
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             COALESCE(input.value->'actions', '[]'::jsonb)
           ) current_action
           WHERE current_action->>'id' = action.id::text
         )
       RETURNING action.workflow_id
     ),
     saved_conditions AS (
       INSERT INTO workflow_conditions (
         id, workflow_id, position, field_id, operator, comparison_value,
         updated_at
       )
       SELECT (condition.value->>'id')::uuid,
         saved_workflow.id,
         (condition.ordinality - 1)::integer,
         condition.value->>'fieldId',
         condition.value->>'operator',
         COALESCE(condition.value->>'value', ''),
         NOW()
       FROM input
       CROSS JOIN saved_workflow
       CROSS JOIN LATERAL jsonb_array_elements(
         COALESCE(input.value->'conditions', '[]'::jsonb)
       ) WITH ORDINALITY condition(value, ordinality)
       ON CONFLICT (id)
       DO UPDATE SET
         position = EXCLUDED.position,
         field_id = EXCLUDED.field_id,
         operator = EXCLUDED.operator,
         comparison_value = EXCLUDED.comparison_value,
         updated_at = NOW()
       RETURNING workflow_id, id
     ),
     removed_conditions AS (
       DELETE FROM workflow_conditions condition
       USING input, saved_workflow
       WHERE condition.workflow_id = saved_workflow.id
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             COALESCE(input.value->'conditions', '[]'::jsonb)
           ) current_condition
           WHERE current_condition->>'id' = condition.id::text
         )
       RETURNING condition.workflow_id
     )
     SELECT id FROM saved_workflow`,
    [JSON.stringify(input), workflowId, formId, userId],
  );
  if (!result.rows[0]) throw new Error("Automation was not found");
  const saved = await getFormWorkflow(userId, formId, workflowId);
  if (!saved) throw new Error("Automation could not be reloaded");
  return saved;
}

export async function setFormWorkflowEnabled(
  userId: string,
  workflowId: string,
  enabled: boolean,
) {
  if (browserRuntime()) {
    return formsRpc<void>("setFormWorkflowEnabled", {
      workflowId,
      enabled,
    });
  }
  await query(
    `UPDATE workflows w
     SET enabled = $1, updated_at = NOW()
     FROM forms f
     WHERE w.form_id = f.id AND w.id = $2 AND f.created_by = $3`,
    [enabled, workflowId, userId],
  );
}

export async function duplicateFormWorkflow(
  userId: string,
  workflow: FormWorkflow,
) {
  if (browserRuntime()) {
    return formsRpc<FormWorkflow>("duplicateFormWorkflow", { workflow });
  }
  return createFormWorkflow(userId, workflow.formId, {
    name: `${workflow.name} copy`,
    description: workflow.description,
    triggerEvent: workflow.triggerEvent,
    actions: workflow.actions.map((action) => ({
      ...action,
      id: crypto.randomUUID(),
      config: { ...action.config },
    })),
    conditions: workflow.conditions.map((condition) => ({
      ...condition,
      id: crypto.randomUUID(),
    })),
    enabled: false,
    runOncePerSubmission: workflow.runOncePerSubmission,
  });
}

export async function deleteFormWorkflow(
  userId: string,
  workflowId: string,
) {
  if (browserRuntime()) {
    return formsRpc<void>("deleteFormWorkflow", { workflowId });
  }
  await query(
    `DELETE FROM workflows w
     USING forms f
     WHERE w.form_id = f.id AND w.id = $1 AND f.created_by = $2`,
    [workflowId, userId],
  );
}

export async function listAutomationConnections(userId: string) {
  if (browserRuntime()) {
    return formsRpc<AutomationConnection[]>("listAutomationConnections");
  }
  const result = await query(
    `SELECT connection.id,
            connection.user_id,
            connection.provider,
            connection.name,
            connection.status,
            connection.auth_type,
            connection.configuration,
            connection.external_account_id,
            connection.external_account_name,
            connection.scopes,
            connection.token_expires_at,
            connection.last_tested_at,
            connection.last_error,
            connection.created_at,
            connection.updated_at
     FROM automation_connections connection
     WHERE connection.user_id = $1
     ORDER BY connection.updated_at DESC`,
    [userId],
  );
  return result.rows.map((row) => {
    const item = row as DatabaseRow;
    const status = asString(item.status);
    return {
      id: asString(item.id),
      provider: asString(item.provider),
      name: asString(item.name),
      authType:
        asString(item.auth_type) === "oauth"
          ? "oauth"
          : asString(item.auth_type) === "endpoint"
            ? "endpoint"
            : "webhook",
      status:
        status === "connected" ||
        status === "error" ||
        status === "disabled"
          ? status
          : "untested",
      config: asJson<Record<string, unknown>>(item.configuration, {}),
      externalAccountId: asString(item.external_account_id) || null,
      externalAccountName: asString(item.external_account_name) || null,
      scopes: asJson<string[]>(item.scopes, []),
      tokenExpiresAt: asString(item.token_expires_at) || null,
      lastTestedAt: asString(item.last_tested_at) || null,
      lastError: asString(item.last_error) || null,
      createdAt: asString(item.created_at),
      updatedAt: asString(item.updated_at),
    } satisfies AutomationConnection;
  });
}

export async function listAutomationProviders() {
  if (browserRuntime()) {
    return formsRpc<AutomationProvider[]>("listAutomationProviders");
  }
  const [result, status] = await Promise.all([
    query(
      `SELECT provider.*
       FROM automation_providers provider
       WHERE provider.enabled = TRUE
       ORDER BY provider.sort_order, provider.name`,
    ),
    (formsServerDependencies
      ? Promise.resolve(formsServerDependencies.getOAuthProviderStatus())
      : getAutomationOAuthProviderStatus()
    ).catch(() => ({})),
  ]);
  const providerStatus = status as Record<
    string,
    { configured: boolean }
  >;
  return result.rows.map((row) => {
    const item = row as DatabaseRow;
    const id = asString(item.id);
    const connectionMode =
      asString(item.connection_mode) === "webhook" ? "webhook" : "oauth";
    return {
      id,
      name: asString(item.name),
      description: asString(item.description),
      logoUrl: asString(item.logo_url) || null,
      connectionMode,
      configured:
        connectionMode === "webhook" ||
        Boolean(providerStatus[id]?.configured),
    } satisfies AutomationProvider;
  });
}

export async function beginAutomationProviderConnection(
  provider: string,
  returnUrl: string,
) {
  const parsedReturnUrl = new URL(returnUrl, window.location.origin);
  const returnTo = `${parsedReturnUrl.pathname}${parsedReturnUrl.search}`;
  const token = localStorage.getItem("access_token");
  const response = await fetch("/api/integrations/oauth?action=prepare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ provider, returnTo }),
  });
  const result = (await response.json()) as {
    authorizationUrl?: string;
  };
  if (!response.ok || !result.authorizationUrl) {
    throw new Error("This integration is temporarily unavailable.");
  }
  return result.authorizationUrl;
}

export type AutomationProviderResource = {
  description?: string;
  label: string;
  value: string;
};

export async function listAutomationProviderResources(
  connectionId: string,
  resource: string,
  parentId = "",
) {
  const token = localStorage.getItem("access_token");
  const params = new URLSearchParams({
    action: "resources",
    connectionId,
    resource,
  });
  if (parentId) params.set("parentId", parentId);
  const response = await fetch(`/api/integrations/oauth?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const result = (await response.json()) as {
    resources?: AutomationProviderResource[];
  };
  if (!response.ok) {
    throw new Error("Destinations could not be loaded.");
  }
  return result.resources || [];
}

export async function saveAutomationConnection(
  userId: string,
  input: {
    id?: string;
    provider: string;
    name: string;
    config: Record<string, unknown>;
    status?: AutomationConnection["status"];
  },
) {
  if (browserRuntime()) {
    return formsRpc<AutomationConnection>("saveAutomationConnection", {
      input,
    });
  }
  const result = input.id
    ? await query(
        `UPDATE automation_connections
         SET provider = $1,
             name = $2,
             configuration = $3::jsonb,
             status = $4,
             auth_type = 'webhook',
             updated_at = NOW()
         WHERE id = $5 AND user_id = $6
         RETURNING *`,
        [
          input.provider,
          input.name,
          JSON.stringify(input.config),
          input.status || "untested",
          input.id,
          userId,
        ],
      )
    : await query(
        `INSERT INTO automation_connections (
           user_id, provider, name, configuration, status, auth_type,
           created_at, updated_at
         )
         VALUES ($1, $2, $3, $4::jsonb, $5, 'webhook', NOW(), NOW())
         RETURNING *`,
        [
          userId,
          input.provider,
          input.name,
          JSON.stringify(input.config),
          input.status || "untested",
        ],
      );
  if (!result.rows[0]) throw new Error("Connection was not found");
  const connections = await listAutomationConnections(userId);
  const id = asString((result.rows[0] as DatabaseRow).id);
  const saved = connections.find((connection) => connection.id === id);
  if (!saved) throw new Error("Connection could not be reloaded");
  return saved;
}

export async function testAutomationConnection(
  userId: string,
  connection: AutomationConnection,
) {
  if (browserRuntime() && connection.authType !== "oauth") {
    return formsRpc<AutomationConnection>("testAutomationConnection", {
      connection,
    });
  }
  if (connection.authType === "oauth") {
    const token = localStorage.getItem("access_token");
    const response = await fetch(
      `/api/integrations/oauth?action=test&connectionId=${encodeURIComponent(connection.id)}`,
      {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    const result = (await response.json()) as {
      connected?: boolean;
      error?: string;
    };
    const connections = await listAutomationConnections(userId);
    const saved =
      connections.find((item) => item.id === connection.id) || connection;
    if (!response.ok && saved.status !== "error") {
      return {
        ...saved,
        status: "error" as const,
        lastError: result.error || "Connection failed",
      };
    }
    return saved;
  }
  const endpointUrl = asString(connection.config.endpointUrl);
  let status: AutomationConnection["status"] = "connected";
  let errorMessage: string | null = null;
  try {
    if (!endpointUrl) throw new Error("Add an endpoint URL before testing");
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "maxform.connection_test",
        provider: connection.provider,
        sentAt: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      throw new Error(`Endpoint returned HTTP ${response.status}`);
    }
  } catch (error) {
    status = "error";
    errorMessage = error instanceof Error ? error.message : "Connection failed";
  }
  await query(
    `UPDATE automation_connections
     SET status = $1,
         last_tested_at = NOW(),
         last_error = $2,
         updated_at = NOW()
     WHERE id = $3 AND user_id = $4`,
    [status, errorMessage, connection.id, userId],
  );
  const connections = await listAutomationConnections(userId);
  return connections.find((item) => item.id === connection.id) || connection;
}

export async function getAutomationOAuthProviderStatus() {
  const response = await fetch(
    "/api/integrations/oauth?action=providers",
  );
  if (!response.ok) throw new Error("OAuth providers could not be loaded");
  const value = (await response.json()) as {
    providers?: Record<string, { configured: boolean }>;
  };
  return value.providers || {};
}

export async function deleteAutomationConnection(
  userId: string,
  connectionId: string,
) {
  if (browserRuntime()) {
    return formsRpc<void>("deleteAutomationConnection", { connectionId });
  }
  await query(
    `DELETE FROM automation_connections
     WHERE id = $1 AND user_id = $2`,
    [connectionId, userId],
  );
}

export async function listAutomationRuns(userId: string, formId: string) {
  if (browserRuntime()) {
    return formsRpc<AutomationRun[]>("listAutomationRuns", { formId });
  }
  const result = await query(
    `SELECT run.*,
       workflow.name AS workflow_name,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', step.id,
               'actionId', step.action_id,
               'position', step.position,
               'actionType', step.action_type,
               'status', step.status,
               'errorMessage', step.error_message,
               'startedAt', step.started_at,
               'completedAt', step.completed_at
             )
             ORDER BY step.position
           )
           FROM automation_run_steps step
           WHERE step.run_id = run.id
         ),
         '[]'::jsonb
       ) AS steps
     FROM automation_runs run
     JOIN workflows workflow ON workflow.id = run.workflow_id
     JOIN forms form ON form.id = run.form_id
     WHERE run.form_id = $1 AND form.created_by = $2
     ORDER BY run.created_at DESC
     LIMIT 100`,
    [formId, userId],
  );
  return result.rows.map((row) => {
    const item = row as DatabaseRow;
    return {
      id: asString(item.id),
      workflowId: asString(item.workflow_id),
      workflowName: asString(item.workflow_name),
      formId: asString(item.form_id),
      submissionId: asString(item.submission_id) || null,
      triggerEvent: asString(item.trigger_event),
      status: asString(item.status) as AutomationRunStatus,
      errorMessage: asString(item.error_message) || null,
      startedAt: asString(item.started_at) || null,
      completedAt: asString(item.completed_at) || null,
      createdAt: asString(item.created_at),
      steps: asJson<AutomationRunStep[]>(item.steps, []),
    } satisfies AutomationRun;
  });
}

const automationTriggerMatches = (
  triggerEvent: FormWorkflow["triggerEvent"],
  data: Record<string, unknown>,
) => {
  const meta = asJson<Record<string, unknown>>(data._meta, {});
  if (triggerEvent === "form_submitted") return true;
  if (triggerEvent === "response_completed") {
    return asString(meta.status) === "completed";
  }
  if (triggerEvent === "response_partial") {
    return asString(meta.status) === "partial";
  }
  return asString(meta.paymentStatus) === "completed";
};

const automationConditionMatches = (
  condition: AutomationCondition,
  answers: Record<string, unknown>,
) => {
  const answer = answers[condition.fieldId];
  const actual = Array.isArray(answer)
    ? answer.map(String).join(", ")
    : asString(answer);
  const expected = condition.value;
  if (condition.operator === "is_answered") {
    return answer != null && actual.trim() !== "";
  }
  if (condition.operator === "equals") return actual === expected;
  if (condition.operator === "not_equals") return actual !== expected;
  if (condition.operator === "contains") {
    return actual.toLowerCase().includes(expected.toLowerCase());
  }
  if (condition.operator === "greater_than") {
    return Number(actual) > Number(expected);
  }
  return Number(actual) < Number(expected);
};

const findAutomationAnswer = (
  form: FormRecord,
  answers: Record<string, unknown>,
  configuredFieldId: unknown,
  fallback: (field: FormField) => boolean,
) => {
  const configured = asString(configuredFieldId);
  const fieldId =
    configured || form.fields.find((field) => fallback(field))?.id || "";
  return answers[fieldId];
};

async function executeCreateContactAction(
  form: FormRecord,
  submissionId: string,
  answers: Record<string, unknown>,
  action: AutomationAction,
) {
  const contactListId = asString(action.config.contactListId);
  const email = asString(
    findAutomationAnswer(
      form,
      answers,
      action.config.emailFieldId,
      (field) => field.type === "email",
    ),
  ).trim();
  if (!email) throw new Error("No email answer was available for the contact");
  if (contactListId) {
    const listResult = await query(
      `SELECT id
       FROM contact_lists
       WHERE id = $1
         AND user_id = $2
         AND list_type = 'static'
       LIMIT 1`,
      [contactListId, form.createdBy],
    );
    if (!listResult.rows[0]) {
      throw new Error("Choose an available static contact list");
    }
  }
  const fullName = asString(
    findAutomationAnswer(
      form,
      answers,
      action.config.fullNameFieldId,
      (field) => /name/i.test(field.label),
    ),
  ).trim();
  const phone = asString(
    findAutomationAnswer(
      form,
      answers,
      action.config.phoneFieldId,
      (field) => field.type === "phone",
    ),
  ).trim();
  const company = asString(
    findAutomationAnswer(
      form,
      answers,
      action.config.companyFieldId,
      (field) => /company|organization|organisation/i.test(field.label),
    ),
  ).trim();
  const tags = Array.isArray(action.config.tags)
    ? action.config.tags.map(String)
    : asString(action.config.tags)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
  if (action.config.legacyUpsert !== true && !contactListId) {
    const configuredName = resolveAutomationTemplate(
      asString(action.config.contactName),
      form,
      submissionId,
      answers,
    ).trim();
    const contact = await (
      formsServerDependencies?.createContact || createCrmContact
    )(form.createdBy, {
      email,
      fullName: configuredName || fullName,
      phone,
      company,
      tags,
      sourceType: "automation",
      sourceId: form.id,
      customFields: {
        sourceFormId: form.id,
        sourceSubmissionId: submissionId,
      },
    });
    return { contactId: contact.id, email: contact.email };
  }
  const result = await query(
    `INSERT INTO contacts (
       email, full_name, phone, company, tags, custom_fields, created_by,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW(), NOW())
     ON CONFLICT (created_by, LOWER(email))
     DO UPDATE SET
       full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), contacts.full_name),
       phone = COALESCE(NULLIF(EXCLUDED.phone, ''), contacts.phone),
       company = COALESCE(NULLIF(EXCLUDED.company, ''), contacts.company),
       tags = EXCLUDED.tags,
       custom_fields = contacts.custom_fields || EXCLUDED.custom_fields,
       updated_at = NOW()
     WHERE contacts.created_by = EXCLUDED.created_by
     RETURNING id`,
    [
      email,
      fullName || null,
      phone || null,
      company || null,
      JSON.stringify(tags),
      JSON.stringify({ sourceFormId: form.id }),
      form.createdBy,
    ],
  );
  if (!result.rows[0]) {
    throw new Error("This email belongs to a contact in another workspace");
  }
  const contactId = asString((result.rows[0] as DatabaseRow).id);
  if (contactListId) {
    await (
      formsServerDependencies?.addContactsToList || addContactsToList
    )(
      form.createdBy,
      contactListId,
      [contactId],
      "automation",
      form.id,
    );
  }
  await query(
    `INSERT INTO contact_activity (
       contact_id, user_id, activity_type, title, detail, entity_type,
       entity_id, metadata, created_at
     )
     VALUES (
       $1, $2, 'automation_upsert', 'Created or updated by automation',
       $3, 'submission', $4, $5::jsonb, NOW()
     )`,
    [
      contactId,
      form.createdBy,
      `Synced from ${form.title}`,
      submissionId,
      JSON.stringify({
        actionId: action.id,
        formId: form.id,
        listId: contactListId || null,
      }),
    ],
  );
  return {
    contactId,
    contactListId: contactListId || null,
    email,
  };
}

async function executeUpdateContactAction(
  form: FormRecord,
  submissionId: string,
  answers: Record<string, unknown>,
  action: AutomationAction,
) {
  const contactId = asString(action.config.targetContactId);
  if (!contactId) throw new Error("Choose a contact to update");
  const fullName = asString(
    findAutomationAnswer(
      form,
      answers,
      action.config.fullNameFieldId,
      () => false,
    ),
  ).trim();
  const email = asString(
    findAutomationAnswer(
      form,
      answers,
      action.config.emailFieldId,
      () => false,
    ),
  ).trim();
  const phone = asString(
    findAutomationAnswer(
      form,
      answers,
      action.config.phoneFieldId,
      () => false,
    ),
  ).trim();
  const company = asString(
    findAutomationAnswer(
      form,
      answers,
      action.config.companyFieldId,
      () => false,
    ),
  ).trim();
  const tags = asString(action.config.tags)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const updates: Parameters<typeof updateCrmContact>[2] = {};
  if (action.config.fullNameFieldId) updates.fullName = fullName;
  if (action.config.emailFieldId) updates.email = email;
  if (action.config.phoneFieldId) updates.phone = phone;
  if (action.config.companyFieldId) updates.company = company;
  if (tags.length > 0) updates.tags = tags;
  if (Object.keys(updates).length === 0) {
    throw new Error("Choose at least one response field to update");
  }
  const contact = await (
    formsServerDependencies?.updateContact || updateCrmContact
  )(form.createdBy, contactId, updates);
  await query(
    `INSERT INTO contact_activity (
       contact_id, user_id, activity_type, title, detail, entity_type,
       entity_id, metadata, created_at
     )
     VALUES (
       $1, $2, 'automation_update', 'Updated by automation',
       $3, 'submission', $4, $5::jsonb, NOW()
     )`,
    [
      contact.id,
      form.createdBy,
      `Updated from ${form.title}`,
      submissionId,
      JSON.stringify({ formId: form.id, actionId: action.id }),
    ],
  );
  return { contactId: contact.id, email: contact.email };
}

const automationTemplateValue = (value: unknown) => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const resolveAutomationTemplate = (
  template: string,
  form: FormRecord,
  submissionId: string,
  answers: Record<string, unknown>,
) =>
  template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (key === "form.title") return form.title;
    if (key === "form.id") return form.id;
    if (key === "form.slug") return form.slug;
    if (key === "submission.id") return submissionId;
    if (key === "submission.created_at") return new Date().toISOString();
    if (key.startsWith("response.")) {
      return automationTemplateValue(answers[key.slice("response.".length)]);
    }
    return "";
  });

async function executeEmailAutomationAction(
  form: FormRecord,
  submissionId: string,
  runId: string,
  answers: Record<string, unknown>,
  action: AutomationAction,
) {
  const recipient = resolveAutomationTemplate(
    asString(action.config.recipient),
    form,
    submissionId,
    answers,
  ).trim();
  const replyTo = resolveAutomationTemplate(
    asString(action.config.replyTo),
    form,
    submissionId,
    answers,
  ).trim();
  const subject = resolveAutomationTemplate(
    asString(action.config.subject),
    form,
    submissionId,
    answers,
  ).trim();
  const message = resolveAutomationTemplate(
    asString(action.config.message),
    form,
    submissionId,
    answers,
  ).trim();
  const templateKey = asString(action.config.templateKey).trim();
  if (!recipient || (!templateKey && (!subject || !message))) {
    throw new Error("Email recipient and either a saved template or a subject and message are required");
  }

  if (formsServerDependencies) {
    const email = await formsServerDependencies.sendAutomationEmail({
      formId: form.id,
      submissionId,
      runId,
      actionId: action.id,
    });
    if (!email.id) throw new Error("The email could not be sent.");
    return {
      channel: "email",
      deliveryId: asString(email.id),
      status: asString(email.status),
    };
  }
  const response = await fetch("/api/email/automation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      formId: form.id,
      submissionId,
      runId,
      actionId: action.id,
    }),
  });
  const delivery = (await response.json().catch(() => ({}))) as {
    email?: { id?: string; status?: string };
    error?: string;
  };
  if (!response.ok || !delivery.email?.id) {
    throw new Error(delivery.error || "The email could not be sent.");
  }
  return {
    channel: "email",
    deliveryId: asString(delivery.email.id),
    status: asString(delivery.email.status),
  };
}

async function executeTagResponseAction(
  form: FormRecord,
  submissionId: string,
  answers: Record<string, unknown>,
  action: AutomationAction,
) {
  const tags = Array.from(
    new Set(
      resolveAutomationTemplate(
        asString(action.config.tags),
        form,
        submissionId,
        answers,
      )
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
  if (tags.length === 0) throw new Error("Add at least one response tag");
  const result = await query(
    `UPDATE form_submissions submission
     SET data = jsonb_set(
       COALESCE(submission.data, '{}'::jsonb),
       '{_meta}',
       COALESCE(submission.data->'_meta', '{}'::jsonb) ||
         jsonb_build_object('automationTags', $1::jsonb),
       TRUE
     )
     WHERE submission.id = $2
       AND submission.form_id = $3
     RETURNING submission.id`,
    [JSON.stringify(tags), submissionId, form.id],
  );
  if (!result.rows[0]) throw new Error("Response was not found");
  return { responseId: submissionId, tags };
}

async function executeExternalAutomationAction(
  form: FormRecord,
  submissionId: string,
  answers: Record<string, unknown>,
  action: AutomationAction,
  connection: AutomationConnection | null,
) {
  const renderWebhookBody = (template: string, payload: Record<string, unknown>) => {
    if (!template.trim()) return JSON.stringify(payload);
    const rendered = template.replace(/{{\s*([^}]+)\s*}}/g, (_match, path: string) => {
      const value = path.trim().split(".").reduce<unknown>((current, key) => {
        if (!current || typeof current !== "object") return undefined;
        return (current as Record<string, unknown>)[key];
      }, payload);
      return value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    });
    try { return JSON.stringify(JSON.parse(rendered)); } catch { return rendered; }
  };
  const payload = {
    event: "maxform.form_submitted",
    action: {
      id: action.id,
      name: action.name,
      type: action.type,
    },
    form: {
      id: form.id,
      slug: form.slug,
      title: form.title,
    },
    fields: form.fields
      .filter(
        (field) =>
          !["section", "pageBreak", "heading", "divider"].includes(field.type),
      )
      .map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
      })),
    submission: {
      id: submissionId,
      submittedAt: new Date().toISOString(),
    },
    answers,
    config: action.config,
  };
  if (connection?.authType === "oauth") {
    if (formsServerDependencies) {
      return formsServerDependencies.executeOAuthAction({
        connectionId: connection.id,
        actionId: action.id,
        formId: form.id,
        submissionId,
      });
    }
    const response = await fetch(
      "/api/integrations/oauth?action=execute",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: connection.id,
          actionId: action.id,
          formId: form.id,
          submissionId,
        }),
      },
    );
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(asString(result.error) || "OAuth action failed");
    }
    return result;
  }
  const centralWebhook = connection?.id && formsServerDependencies?.getWebhookConfig
    ? await formsServerDependencies.getWebhookConfig(form.createdBy, connection.id)
    : null;
  let endpointUrl =
    asString(action.config.endpointUrl) ||
    asString(centralWebhook?.endpointUrl) ||
    asString(connection?.config.endpointUrl);
  if (!endpointUrl) {
    throw new Error(`${action.name} needs an endpoint or connected integration`);
  }
  if (centralWebhook) {
    const url = new URL(endpointUrl);
    for (const [key, value] of Object.entries(centralWebhook.query)) url.searchParams.set(key, value);
    endpointUrl = url.toString();
  }
  let headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const configuredHeaders =
    action.config.headers || centralWebhook?.headers || connection?.config.headers || {};
  if (
    configuredHeaders &&
    typeof configuredHeaders === "object" &&
    !Array.isArray(configuredHeaders)
  ) {
    headers = {
      ...headers,
      ...Object.fromEntries(
        Object.entries(configuredHeaders).map(([key, value]) => [
          key,
          asString(value),
        ]),
      ),
    };
  }
  if (centralWebhook) {
    if (centralWebhook.authType === "bearer") headers.Authorization = `Bearer ${centralWebhook.authSecret || ""}`;
    if (centralWebhook.authType === "api_key" && centralWebhook.authHeader) headers[centralWebhook.authHeader] = centralWebhook.authSecret || "";
    if (centralWebhook.authType === "basic") headers.Authorization = `Basic ${Buffer.from(`${centralWebhook.username || ""}:${centralWebhook.password || ""}`).toString("base64")}`;
  } else {
    const authToken =
      asString(action.config.authToken) ||
      asString(connection?.config.authToken);
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
  }

  const body =
    action.type === "slack"
      ? {
          text:
            asString(action.config.message) ||
            `New response received for ${form.title}`,
          maxform: payload,
        }
      : payload;
  const requestBody = centralWebhook?.bodyTemplate
    ? renderWebhookBody(centralWebhook.bodyTemplate, payload)
    : JSON.stringify(body);
  const response = await fetch(endpointUrl, {
    method: asString(action.config.method) || centralWebhook?.method || "POST",
    headers,
    body: (asString(action.config.method) || centralWebhook?.method || "POST") === "GET" ? undefined : requestBody,
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Integration returned HTTP ${response.status}${
        responseText ? `: ${responseText.slice(0, 180)}` : ""
      }`,
    );
  }
  return {
    httpStatus: response.status,
    response: responseText.slice(0, 500),
  };
}

async function executeSubmissionAutomations(
  form: FormRecord,
  submissionId: string,
  answers: Record<string, unknown>,
  data: Record<string, unknown>,
) {
  const [workflows, connections] = await Promise.all([
    listFormWorkflows(form.createdBy, form.id),
    listAutomationConnections(form.createdBy),
  ]);
  const connectionMap = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  for (const workflow of workflows) {
    if (
      !workflow.enabled ||
      !automationTriggerMatches(workflow.triggerEvent, data)
    ) {
      continue;
    }
    if (
      !workflow.conditions.every((condition) =>
        automationConditionMatches(condition, answers),
      )
    ) {
      continue;
    }
    if (workflow.runOncePerSubmission) {
      const existing = await query(
        `SELECT id
         FROM automation_runs
         WHERE workflow_id = $1 AND submission_id = $2
         LIMIT 1`,
        [workflow.id, submissionId],
      );
      if (existing.rows.length > 0) continue;
    }

    const runResult = await query(
      `INSERT INTO automation_runs (
         workflow_id, form_id, submission_id, trigger_event, status,
         input_data, started_at, created_at
       )
       VALUES ($1, $2, $3, $4, 'running', $5::jsonb, NOW(), NOW())
       RETURNING id`,
      [
        workflow.id,
        form.id,
        submissionId,
        workflow.triggerEvent,
        JSON.stringify({ answers }),
      ],
    );
    const runId = asString((runResult.rows[0] as DatabaseRow).id);
    let failedMessage = "";
    let completedSteps = 0;
    for (const [position, action] of workflow.actions.entries()) {
      if (!action.enabled) continue;
      const stepResult = await query(
        `INSERT INTO automation_run_steps (
           run_id, action_id, position, action_type, status, request_data,
           started_at, created_at
         )
         VALUES ($1, $2, $3, $4, 'running', $5::jsonb, NOW(), NOW())
         RETURNING id`,
        [
          runId,
          action.id,
          position,
          action.type,
          JSON.stringify({ config: action.config }),
        ],
      );
      const stepId = asString((stepResult.rows[0] as DatabaseRow).id);
      try {
        const output =
          action.type === "create_contact"
            ? await executeCreateContactAction(
                form,
                submissionId,
                answers,
                action,
              )
            : action.type === "update_contact"
              ? await executeUpdateContactAction(
                  form,
                  submissionId,
                  answers,
                  action,
                )
            : action.type === "send_email"
              ? await executeEmailAutomationAction(
                  form,
                  submissionId,
                  runId,
                  answers,
                  action,
                )
            : action.type === "notify_team"
              ? await executeEmailAutomationAction(
                  form,
                  submissionId,
                  runId,
                  answers,
                  action,
                )
            : action.type === "tag_response"
              ? await executeTagResponseAction(
                  form,
                  submissionId,
                  answers,
                  action,
                )
            : await executeExternalAutomationAction(
                form,
                submissionId,
                answers,
                action,
                action.connectionId
                  ? connectionMap.get(action.connectionId) || null
                  : null,
              );
        await query(
          `UPDATE automation_run_steps
           SET status = 'succeeded',
               response_data = $1::jsonb,
               completed_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(output), stepId],
        );
        completedSteps += 1;
      } catch (error) {
        failedMessage =
          error instanceof Error ? error.message : "Automation action failed";
        await query(
          `UPDATE automation_run_steps
           SET status = 'failed',
               error_message = $1,
               completed_at = NOW()
           WHERE id = $2`,
          [failedMessage, stepId],
        );
        if (action.config.continueOnError !== true) break;
      }
    }
    await query(
      `UPDATE automation_runs
       SET status = $1,
           output_data = $2::jsonb,
           error_message = $3,
           completed_at = NOW()
       WHERE id = $4`,
      [
        failedMessage ? "failed" : "succeeded",
        JSON.stringify({ completedSteps }),
        failedMessage || null,
        runId,
      ],
    );
  }
}

export async function getPublicForm(formId: string, workspaceId?: string) {
  if (browserRuntime()) {
    return formsRpc<FormRecord | null>("getPublicForm", {
      formId,
      workspaceId,
    });
  }
  const result = await query(
    `SELECT ${canonicalFormSelect}
     FROM forms f
     WHERE (f.slug = $1 OR f.id::text = $1)
       AND f.status = 'published'
       AND (
         $2::text IS NULL
         OR f.created_by = (SELECT id FROM users WHERE short_id = $2::text)
       )
     LIMIT 1`,
    [formId, workspaceId || null],
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0] as DatabaseRow;
  const workspaceAccent = workspaceAccentColor(row.workspace_brand_color);
  const form = mapForm(row);
  const live = form.settings.liveSnapshot;
  const usableLiveSnapshot =
    live && typeof live === "object" && !Array.isArray(live) ? live : null;
  let publicForm = usableLiveSnapshot
    ? ({
        ...form,
        title: usableLiveSnapshot.title || form.title,
          description: usableLiveSnapshot.description ?? form.description,
        fields: Array.isArray(usableLiveSnapshot.fields)
          ? usableLiveSnapshot.fields
          : form.fields,
          settings: {
            ...form.settings,
            theme: normalizeFormTheme(
              usableLiveSnapshot.theme,
              workspaceAccent,
            ),
          payment:
            usableLiveSnapshot.payment || form.settings.payment,
          version:
            Number(usableLiveSnapshot.version) || form.settings.version,
          hasUnpublishedChanges: false,
        },
      } satisfies FormRecord)
    : form;
  const catalogProductIds = [
    ...new Set(
      publicForm.fields
        .filter((field) => field.type === "product")
        .flatMap((field) => field.config?.productIds || []),
    ),
  ].filter(Boolean);
  if (catalogProductIds.length > 0) {
    await query(`SELECT maxform_release_expired_payment_inventory()`);
    const catalogResult = await query(
      `SELECT product.id, product.name, product.description,
              product.short_description, product.sku, product.price,
              product.sale_price, product.currency, product.image_url,
              product.image_gallery, product.promotional_banner, product.category,
              product.product_status, product.availability_start_at,
              product.availability_end_at, product.min_quantity,
              product.max_quantity, product.one_per_customer,
              product.hide_when_sold_out, product.requires_shipping,
              product.track_inventory, product.inventory_quantity,
              product.allow_backorder,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', variant.id,
                  'name', variant.name,
                  'sku', variant.sku,
                  'price', variant.price,
                  'salePrice', variant.sale_price,
                  'description', variant.description,
                  'imageUrl', variant.image_url,
                  'optionValues', variant.option_values,
                  'availableQuantity', CASE WHEN variant.track_inventory
                    THEN variant.inventory_quantity ELSE NULL END,
                  'allowBackorder', variant.allow_backorder,
                  'weightGrams', variant.weight_grams,
                  'availabilityStartAt', variant.availability_start_at,
                  'availabilityEndAt', variant.availability_end_at
                ) ORDER BY variant.sort_order, variant.created_at)
                FROM payment_product_variants variant
                WHERE variant.product_id = product.id AND variant.active = TRUE
              ), '[]'::jsonb) AS variants
       FROM payment_products product
       WHERE product.user_id = $1
         AND product.id = ANY($2::uuid[])
         AND product.active = TRUE
         AND product.billing_type = 'one_time'`,
      [publicForm.createdBy, catalogProductIds],
    );
    const products = catalogResult.rows.map((row) => ({
      id: asString(row.id),
      name: asString(row.name),
      description: asString(row.description),
      shortDescription: asString(row.short_description),
      sku: asString(row.sku),
      price: asNumber(row.price),
      salePrice: row.sale_price == null ? null : asNumber(row.sale_price),
      currency: asString(row.currency),
      imageUrl: asString(row.image_url),
      imageGallery: asJson<string[]>(row.image_gallery, []).filter(Boolean),
      promotionalBanner: asString(row.promotional_banner),
      category: asString(row.category),
      categories: asString(row.category)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      status: (asString(row.product_status) || "active") as FormCatalogProduct["status"],
      availabilityStartAt: asString(row.availability_start_at),
      availabilityEndAt: asString(row.availability_end_at),
      minQuantity: asNumber(row.min_quantity) || 1,
      maxQuantity: asNumber(row.max_quantity) || 1000,
      onePerCustomer: asBoolean(row.one_per_customer),
      hideWhenSoldOut: asBoolean(row.hide_when_sold_out),
      requiresShipping: asBoolean(row.requires_shipping),
      availableQuantity: asBoolean(row.track_inventory)
        ? Math.max(0, asNumber(row.inventory_quantity))
        : null,
      allowBackorder: asBoolean(row.allow_backorder),
      variants: asJson<FormCatalogProductVariant[]>(row.variants, []),
    }));
    const productById = new Map(products.map((product) => [product.id, product]));
    publicForm = {
      ...publicForm,
      fields: publicForm.fields.map((field) =>
        field.type === "product"
          ? {
              ...field,
              config: {
                ...field.config,
                catalogProducts: (field.config?.productIds || [])
                  .map((productId) => productById.get(productId))
                  .filter((product): product is NonNullable<typeof product> => Boolean(product)),
              },
            }
          : field,
      ),
    };
  }
  const eventResult = await query(
    `SELECT id
     FROM events
     WHERE registration_form_id = $1
       AND ticketing_enabled = TRUE
     LIMIT 1`,
    [publicForm.id],
  );
  if (eventResult.rows[0]) {
    const ticketResult = await query(
      `SELECT ticket_type.name, ticket_type.description, ticket_type.price,
         ticket_type.currency, ticket_type.color, ticket_type.min_per_order,
         ticket_type.max_per_order, ticket_type.quantity_available,
         (SELECT COUNT(*)
          FROM event_attendees attendee
          WHERE attendee.ticket_type_id = ticket_type.id
            AND attendee.ticket_status IN ('valid', 'transferred')) AS sold_count
       FROM event_ticket_types ticket_type
       WHERE ticket_type.event_id = $1 AND ticket_type.active = TRUE
       ORDER BY ticket_type.sort_order, ticket_type.created_at`,
      [(eventResult.rows[0] as DatabaseRow).id],
    );
    const ticketField = publicForm.fields.find(
      (field) => field.id === "ticket-selection",
    );
    const options = ticketResult.rows.map((row) => asString(row.name));
    const ticketLimits = Object.fromEntries(
      ticketResult.rows.map((row) => [
         asString(row.name),
         {
          color: asString(row.color),
          currency: asString(row.currency),
          description: asString(row.description),
          min: Math.max(1, asNumber(row.min_per_order) || 1),
          max: Math.max(1, asNumber(row.max_per_order) || 1),
          price: Math.max(0, asNumber(row.price)),
          remaining: Math.max(
            0,
            asNumber(row.quantity_available) - asNumber(row.sold_count),
          ),
        },
      ]),
    );
    const nextTicketField = ticketField
      ? {
          ...ticketField,
          options,
          config: { ...ticketField.config, ticketLimits },
        }
      : {
          id: "ticket-selection",
          type: "dropdown" as const,
          label: "Choose your ticket",
          options,
          required: true,
          width: "full" as const,
          config: { ticketLimits },
        };
    publicForm = {
      ...publicForm,
      fields: [
        ...publicForm.fields.filter(
          (field) => field.id !== "ticket-selection",
        ),
        nextTicketField,
      ],
    };
  }
  if (!publicForm.settings.confirmation.useModuleDefault) return publicForm;
  const preferences =
    (await getFormModulePreferences(publicForm.createdBy)) ||
    defaultFormModulePreferences;
  return {
    ...publicForm,
    settings: {
      ...publicForm.settings,
      confirmation: {
        ...preferences.confirmation,
        useModuleDefault: true,
      },
    },
  } satisfies FormRecord;
}

export const verifyPublicFormAccess = (
  formId: string,
  password: string,
) =>
  formsRpc<{ accessToken: string }>("verifyPublicFormAccess", {
    formId,
    password,
  });

type PublicSubmissionOptions = {
  /** Short-lived server grant for a password-protected form. */
  accessToken?: string;
  /** A per-browser response key used to make retries idempotent. */
  clientSubmissionKey?: string;
  /** Paid responses are held privately until checkout confirms payment. */
  pendingPayment?: boolean;
};

const uploadSubmissionMedia = async (
  form: FormRecord,
  media: SubmissionMediaRow[],
): Promise<StoredSubmissionMediaRow[]> =>
  Promise.all(
    media.map(async (file) => {
      const stored: StoredObject = await uploadFileToStorage(
        file.content,
        {
          purpose: "form_response",
          formId: form.id,
          fieldId: file.fieldId,
          fileName: file.fileName,
          authenticated: false,
        },
      );
      return {
        id: file.id,
        fieldId: file.fieldId,
        fileKind: file.fileKind,
        fileName: file.fileName,
        mimeType: stored.mimeType,
        fileSize: stored.sizeBytes,
        storageObjectId: stored.id,
      };
    }),
  );

export async function submitPreparedPublicForm(
  form: FormRecord,
  storedAnswers: Record<string, unknown>,
  storedMedia: StoredSubmissionMediaRow[],
  meta: {
    country?: string;
    referrer?: string;
    userAgent?: string;
    utm?: Record<string, string>;
  },
  options: PublicSubmissionOptions = {},
) {
  const verifiedMedia = await (async () => {
    if (storedMedia.length === 0) return [] as StoredSubmissionMediaRow[];
    const objectIds = storedMedia.map((file) =>
      asString(file.storageObjectId),
    );
    const result = await query<{
      field_id: string;
      file_name: string;
      id: string;
      mime_type: string;
      size_bytes: number;
    }>(
      `SELECT object.id,
              object.file_name,
              object.mime_type,
              object.size_bytes,
              session.field_id
       FROM storage_objects object
       JOIN storage_upload_sessions session
         ON session.storage_object_id = object.id
       WHERE object.id = ANY($1::uuid[])
         AND object.source_id = $2
         AND object.purpose = 'form_response'
         AND object.status = 'ready'
         AND object.scan_status = 'validated'
         AND object.deleted_at IS NULL`,
      [objectIds, form.id],
    );
    const objects = new Map(result.rows.map((row) => [row.id, row]));
    if (objects.size !== new Set(objectIds).size) {
      throw new Error("One or more uploaded files are no longer available.");
    }
    return storedMedia.map((file) => {
      const object = objects.get(asString(file.storageObjectId));
      const field = form.fields.find(
        (candidate) => candidate.id === asString(file.fieldId),
      );
      if (
        !object ||
        !field ||
        !["file", "multipleFiles", "camera", "signature"].includes(field.type) ||
        object.field_id !== field.id
      ) {
        throw new Error("One or more uploaded files are not valid.");
      }
      return {
        id: asString(file.id),
        fieldId: field.id,
        fileKind: field.type === "signature" ? "signature" : "file",
        fileName: object.file_name,
        mimeType: object.mime_type,
        fileSize: asNumber(object.size_bytes),
        storageObjectId: object.id,
      } satisfies StoredSubmissionMediaRow;
    });
  })();
  const canonicalAnswers = canonicalizePreparedFormSubmission(
    form,
    storedAnswers,
    verifiedMedia,
  );
  const pendingPayment = options.pendingPayment === true;
  const safeUtm =
    meta.utm && typeof meta.utm === "object"
      ? Object.fromEntries(
          Object.entries(meta.utm)
            .slice(0, 20)
            .map(([key, value]) => [
              key.slice(0, 80),
              asString(value).slice(0, 500),
            ]),
        )
      : {};
  const data = {
    ...canonicalAnswers,
    _meta: {
      status: pendingPayment ? "pending_payment" : "completed",
      formVersion: form.settings.version,
      paymentStatus: pendingPayment ? "pending" : null,
      country: asString(meta.country).slice(0, 120) || null,
      referrer: asString(meta.referrer).slice(0, 2_000) || null,
      utm: safeUtm,
    },
  };
  const clientSubmissionKey = options.clientSubmissionKey || null;
  let submission: DatabaseRow | null = null;
  let created = false;
  try {
    const inserted = await query(
      `WITH input AS (
         SELECT $1::uuid AS form_id,
           $2::jsonb AS data,
           $3::text AS user_agent,
           $4::uuid AS client_submission_key,
           $5::jsonb AS files
       ),
       saved_submission AS (
         INSERT INTO form_submissions (
           form_id, data, submitted_at, user_agent, client_submission_key
         )
         SELECT input.form_id, input.data, NOW(), input.user_agent,
           input.client_submission_key
         FROM input
         ON CONFLICT (form_id, client_submission_key)
           WHERE client_submission_key IS NOT NULL
         DO NOTHING
         RETURNING id, submitted_at, data
       ),
       saved_answers AS (
         INSERT INTO form_submission_answers (
           submission_id, field_id, answer
         )
         SELECT saved_submission.id, answer.key, answer.value
         FROM input
         CROSS JOIN saved_submission
         CROSS JOIN LATERAL jsonb_each(input.data) answer(key, value)
         WHERE answer.key <> '_meta'
         RETURNING submission_id
       ),
       saved_files AS (
         INSERT INTO form_submission_files (
           id, submission_id, form_id, field_id, file_kind, file_name,
           mime_type, file_size, storage_object_id
         )
         SELECT
           (file.value->>'id')::uuid,
           saved_submission.id,
           input.form_id,
           file.value->>'fieldId',
           file.value->>'fileKind',
           stored_object.file_name,
           stored_object.mime_type,
           stored_object.size_bytes::integer,
           stored_object.id
         FROM input
         CROSS JOIN saved_submission
         CROSS JOIN LATERAL jsonb_array_elements(input.files) file(value)
         JOIN storage_objects stored_object
           ON stored_object.id = (file.value->>'storageObjectId')::uuid
          AND stored_object.source_id = input.form_id
          AND stored_object.purpose = 'form_response'
          AND stored_object.status = 'ready'
          AND stored_object.scan_status = 'validated'
          AND stored_object.deleted_at IS NULL
         RETURNING id
       )
       SELECT saved_submission.id, saved_submission.submitted_at,
         COALESCE(saved_submission.data #>> '{_meta,status}', 'completed')
           AS submission_status,
         COALESCE(saved_submission.data #>> '{_meta,paymentStatus}', '')
           AS payment_status
       FROM saved_submission`,
      [
        form.id,
        JSON.stringify(data),
        asString(meta.userAgent).slice(0, 500) || null,
        clientSubmissionKey,
        JSON.stringify(verifiedMedia),
      ],
    );
    if (inserted.rows[0]) {
      submission = inserted.rows[0] as DatabaseRow;
      created = true;
    } else if (clientSubmissionKey && pendingPayment) {
      const updated = await query(
        `SELECT *
         FROM maxform_replace_pending_submission_content(
           $1::uuid, $2::uuid, $3::jsonb, $4::text, $5::jsonb
         )`,
        [
          form.id,
          clientSubmissionKey,
          JSON.stringify(data),
          asString(meta.userAgent).slice(0, 500) || null,
          JSON.stringify(verifiedMedia),
        ],
      );
      if (updated.rows[0]) {
        submission = updated.rows[0] as DatabaseRow;
      }
    }
    if (!submission && clientSubmissionKey) {
      const existing = await query(
        `SELECT id, submitted_at,
           COALESCE(data #>> '{_meta,status}', 'completed') AS submission_status,
           COALESCE(data #>> '{_meta,paymentStatus}', '') AS payment_status
         FROM form_submissions
         WHERE form_id = $1 AND client_submission_key = $2::uuid
         LIMIT 1`,
        [form.id, clientSubmissionKey],
      );
      submission = (existing.rows[0] as DatabaseRow | undefined) || null;
    }
  } catch {
    throw new Error(
      "We could not save your response. Check your connection and try again.",
    );
  }
  if (!submission) {
    throw new Error(
      "We could not save your response. Check your connection and try again.",
    );
  }

  let eventAccess: DatabaseRow | null = null;
  if (!pendingPayment) {
    try {
      const accessResult = await query(`
        SELECT event.title, event.event_date, event.range_start_date,
          event.schedule_start_time, event.schedule_end_time, event.timezone,
          event.online_url, event.settings
        FROM events event
        WHERE event.registration_form_id = $1
          AND event.ticketing_enabled = FALSE
          AND event.status IN ('published', 'on_sale', 'sold_out', 'past')
          AND event.location_type IN ('online', 'hybrid')
          AND NULLIF(event.online_url, '') IS NOT NULL
        LIMIT 1`,
        [form.id],
      );
      const access = accessResult.rows[0] as DatabaseRow | undefined;
      if (access) {
        const eventSettings = asJson<DatabaseRow>(access.settings, {});
        const meetingIntegration = eventSettings.meetingIntegration && typeof eventSettings.meetingIntegration === "object"
          ? eventSettings.meetingIntegration as DatabaseRow
          : {};
        eventAccess = {
          date: asString(access.event_date) || asString(access.range_start_date),
          endTime: asString(access.schedule_end_time),
          eventTitle: asString(access.title),
          joinUrl: asString(access.online_url),
          meetingProvider: asString(meetingIntegration.providerLabel || meetingIntegration.provider),
          startTime: asString(access.schedule_start_time),
          timezone: asString(access.timezone) || "UTC",
        };
      }
    } catch {
      // Access information is an enhancement; never make a saved response fail.
    }
  }

  // Contacts and automations represent a received response, so never run them
  // for a checkout that is still awaiting payment or for an idempotent retry.
  if (!created || pendingPayment) return eventAccess ? { ...submission, eventAccess } : submission;
  try {
    const eventResult = await query<{ id: string }>(
      `SELECT id
       FROM events
       WHERE registration_form_id = $1
         AND ticketing_enabled = FALSE
       LIMIT 1`,
      [form.id],
    );
    const eventId = asString(eventResult.rows[0]?.id);
    if (eventId && formsServerDependencies?.sendEventRegistrationEmail) {
      await formsServerDependencies.sendEventRegistrationEmail(
        eventId,
        asString(submission.id),
      );
    }
  } catch {
    // Event lifecycle email delivery is isolated from the saved response.
  }
  try {
    await (
      formsServerDependencies?.syncSubmissionContact ||
      syncSubmissionContact
    )(
      form,
      asString(submission.id),
      canonicalAnswers,
    );
  } catch {
    // Contact routing is isolated from the saved respondent submission.
  }
  try {
    await executeSubmissionAutomations(
      form,
      asString(submission.id),
      canonicalAnswers,
      data,
    );
  } catch {
    // Automation delivery retries independently from the saved submission.
  }
  try {
    await formsServerDependencies?.dispatchWorkspaceWorkflowEvent?.(
      form.createdBy,
      "form_submission",
      {
        id: asString(submission.id),
        formId: form.id,
        form: { id: form.id, title: form.title, slug: form.slug },
        answers: canonicalAnswers,
        data,
      },
      `form_submission:${asString(submission.id)}`,
    );
  } catch {
    // Cross-module workflows are isolated from the saved public response and
    // the existing Forms automation engine.
  }
  return eventAccess ? { ...submission, eventAccess } : submission;
}

export async function submitPublicForm(
  form: FormRecord,
  answers: Record<string, FormAnswerValue | unknown>,
  meta: {
    country?: string;
    referrer?: string;
    userAgent?: string;
    utm?: Record<string, string>;
  },
  options: PublicSubmissionOptions = {},
) {
  const prepared = prepareFormSubmissionAnswers(form, answers);
  const storedMedia = await uploadSubmissionMedia(form, prepared.media);
  if (browserRuntime()) {
    return formsRpc<DatabaseRow>("submitPublicForm", {
      formId: form.id,
      storedAnswers: prepared.storedAnswers,
      storedMedia,
      meta,
      options,
    });
  }
  return submitPreparedPublicForm(
    form,
    prepared.storedAnswers,
    storedMedia,
    meta,
    options,
  );
}

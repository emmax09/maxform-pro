import {
  defaultPreloaderSettings,
  type PreloaderSettings,
} from "../shared/preloader-config";

export const formFieldTypes = [
  "shortText",
  "longText",
  "email",
  "phone",
  "number",
  "url",
  "password",
  "dropdown",
  "multiSelect",
  "radio",
  "checkboxes",
  "yesNo",
  "rating",
  "scale",
  "ranking",
  "matrix",
  "date",
  "time",
  "dateRange",
  "appointment",
  "file",
  "multipleFiles",
  "imageChoice",
  "signature",
  "camera",
  "section",
  "pageBreak",
  "heading",
  "divider",
  "html",
  "address",
  "location",
  "product",
  "orderSummary",
  "coupon",
  "hidden",
  "calculated",
] as const;

export type FormFieldType = (typeof formFieldTypes)[number];

export type FormBlockStyle = {
  /** Color of the field content when a more specific color is not set. */
  textColor?: string;
  /** Label and supporting-copy colors for this field. */
  labelColor?: string;
  helpTextColor?: string;
  /** Typography applied to this field and its controls. */
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 300 | 400 | 500 | 600 | 700 | 800;
  lineHeight?: number;
  /** Surface and border of the field's outer block. */
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "dotted" | "none";
  borderRadius?: number;
  /** Surface, text, placeholder, and border of the actual input control. */
  inputBackgroundColor?: string;
  inputTextColor?: string;
  placeholderColor?: string;
  inputBorderColor?: string;
  inputBorderWidth?: number;
  inputBorderStyle?: "solid" | "dashed" | "dotted" | "none";
  inputBorderRadius?: number;
  padding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  margin?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
};

export type FormProductDisplayConfig = {
  style?: "cards" | "grid" | "list" | "compact" | "large" | "image";
  columns?: 1 | 2 | 3 | 4;
  imageSize?: "small" | "medium" | "large";
  imageAspectRatio?: "square" | "landscape" | "portrait";
  cardBackground?: string;
  cardBorderColor?: string;
  cardBorderRadius?: number;
  cardPadding?: number;
  cardSpacing?: number;
  imageAlignment?: "left" | "center" | "right";
  textAlignment?: "left" | "center" | "right";
  selectionStyle?: "button" | "checkbox" | "radio";
  showOrderSummary?: boolean;
  hideSoldOutProducts?: boolean;
};

export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  options?: string[];
  defaultValue?: string;
  formula?: string;
  width?: "full" | "half";
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
  config?: {
    acceptedFileTypes?: "any" | "images" | "documents" | "pdf";
    blockStyle?: FormBlockStyle;
    maxFileSizeMb?: number;
    maxFiles?: number;
    matrixRows?: string[];
    optionImages?: Record<string, string>;
    optionPrices?: Record<string, number>;
    productIds?: string[];
    catalogProducts?: FormCatalogProduct[];
    allowMultipleProducts?: boolean;
    showProductQuantity?: boolean;
    minProductQuantity?: number;
    maxProductQuantity?: number;
    productCouponsEnabled?: boolean;
    productDisplay?: FormProductDisplayConfig;
    signatureBackgroundColor?: string;
    signaturePenColor?: string;
    ticketLimits?: Record<
      string,
       {
         color?: string;
         currency?: string;
         description?: string;
         min: number;
         max: number;
         price?: number;
         remaining: number;
       }
    >;
  };
};

export type FormCatalogProductVariant = {
  id: string;
  name: string;
  sku: string;
  price: number;
  salePrice?: number | null;
  description?: string;
  imageUrl?: string;
  optionValues: Record<string, string>;
  availableQuantity: number | null;
  allowBackorder: boolean;
  weightGrams?: number;
  availabilityStartAt?: string;
  availabilityEndAt?: string;
};

export type FormCatalogProduct = {
  id: string;
  name: string;
  description: string;
  shortDescription?: string;
  sku: string;
  price: number;
  salePrice?: number | null;
  currency: string;
  imageUrl?: string;
  imageGallery?: string[];
  promotionalBanner?: string;
  category?: string;
  categories?: string[];
  status?: "active" | "draft" | "hidden" | "sold_out";
  availabilityStartAt?: string;
  availabilityEndAt?: string;
  minQuantity?: number;
  maxQuantity?: number;
  onePerCustomer?: boolean;
  hideWhenSoldOut?: boolean;
  requiresShipping: boolean;
  availableQuantity: number | null;
  allowBackorder: boolean;
  variants: FormCatalogProductVariant[];
};

export type FormProductSelection = {
  productId: string;
  variantId?: string;
  quantity: number;
};

export type FormFileAnswer = {
  kind: "file";
  file?: File;
  /** Transitional support for drafts created before direct R2 uploads. */
  dataUrl?: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type FormSignatureAnswer = {
  kind: "signature";
  dataUrl: string;
  height: number;
  width: number;
};

export type FormStructuredAnswer = Record<string, string | number>;

export type FormAnswerValue =
  | string
  | string[]
  | number
  | boolean
  | FormFileAnswer
  | FormFileAnswer[]
  | FormSignatureAnswer
  | FormStructuredAnswer
  | FormProductSelection[];

export type FormLogicOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "greater_than"
  | "less_than"
  | "is_answered";

export type FormLogicAction = "show" | "hide" | "skip_to" | "require";

export type FormLogicRule = {
  id: string;
  sourceFieldId: string;
  operator: FormLogicOperator;
  value: string;
  action: FormLogicAction;
  targetFieldId: string;
};

export type FormTheme = {
  accentColor: string;
  /** Whether the accent follows workspace branding or is a form override. */
  accentColorMode?: "workspace" | "custom";
  /** The background behind the whole public form page. */
  backgroundColor: string;
  /** The card that contains the form; empty keeps it matched to the page. */
  containerBackgroundColor: string;
  /** Form container border controls. Kept separate from field block styling. */
  containerBorderColor: string;
  containerBorderWidth: number;
  containerBorderStyle: "solid" | "dashed" | "dotted" | "none";
  containerBorderRadius: number;
  /** Page-level layout controls. */
  pageLayout: "standard" | "wide" | "full";
  textColor: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 300 | 400 | 500 | 600 | 700 | 800;
  lineHeight: number;
  radius: number;
  blockStyle: FormBlockStyle;
  buttonStyle: "solid" | "outline" | "soft";
  respondentMode: "light" | "dark" | "auto";
  coverImageUrl: string;
  logoUrl: string;
  preloader: PreloaderSettings;
  customCss: string;
};

export type FormShippingMode =
  | "flat"
  | "destination"
  | "weight"
  | "quantity"
  | "advanced";

export type FormShippingRateType = "flat" | "per_item" | "weight";

export type FormShippingCountryPolicy =
  | "worldwide"
  | "allowlist"
  | "blocklist";

export type FormShippingRule = {
  id?: string;
  name?: string;
  active?: boolean;
  /** Legacy single-country field retained for existing saved rules. */
  country: string;
  /** Optional multi-country ISO/name values for new rules. */
  countries?: string[];
  region: string;
  postalCode?: string;
  amount: number;
  freeShippingThreshold: number;
  rateType?: FormShippingRateType;
  perItemAmount?: number;
  perWeightUnitAmount?: number;
  handlingFee?: number;
  minSubtotal?: number;
  maxSubtotal?: number;
  minQuantity?: number;
  maxQuantity?: number;
  minWeightGrams?: number;
  maxWeightGrams?: number;
  deliveryEstimate?: string;
};

export type FormPaymentSettings = {
  enabled: boolean;
  /**
   * Enables the catalog-backed commerce flow for Product fields. This is
   * intentionally separate from the ordinary form-payment switch and amount.
   */
  productCommerceEnabled?: boolean;
  mode: "fixed" | "variable" | "product" | "cart";
  provider: "workspace" | "stripe" | "paypal" | "paystack" | "opay";
  productId: string;
  amount: number;
  currency: string;
  allowCoupons: boolean;
  shippingEnabled: boolean;
  shippingAmount: number;
  freeShippingThreshold: number;
  taxEnabled: boolean;
  taxMode: "product" | "destination";
  destinationTaxRate: number;
  taxRules: Array<{
    country: string;
    region: string;
    rate: number;
  }>;
  shippingMode: FormShippingMode;
  shippingRateType?: FormShippingRateType;
  shippingWeightUnit?: "g" | "kg" | "lb";
  shippingHandlingFee?: number;
  shippingPerItemAmount?: number;
  shippingPerWeightUnitAmount?: number;
  shippingPackageWeightGrams?: number;
  shippingCountryPolicy?: FormShippingCountryPolicy;
  shippingCountries?: string[];
  shippingDefaultDeliveryEstimate?: string;
  shippingRules: FormShippingRule[];
};

export type FormVersion = {
  id: string;
  version: number;
  publishedAt: string;
  publishedBy: string;
  fields: FormField[];
  title: string;
  description: string;
};

export type FormLiveSnapshot = {
  fields: FormField[];
  theme: FormTheme;
  payment: FormPaymentSettings;
  version: number;
  title: string;
  description: string;
  slug?: string;
};

export type FormConfirmationSettings = {
  useModuleDefault: boolean;
  type: "message" | "redirect" | "message_redirect";
  title: string;
  message: string;
  redirectUrl: string;
  redirectDelay: number;
  /** Optional label for the form's final submit/payment action. */
  submitButtonLabel: string;
  buttonLabel: string;
  buttonUrl: string;
  allowAnotherResponse: boolean;
  showResponseSummary: boolean;
  icon: "check" | "mail" | "heart" | "none";
  accentColor: string;
  backgroundColor: string;
  textAlign: "left" | "center";
};

export type FormSettings = {
  logic: FormLogicRule[];
  theme: FormTheme;
  payment: FormPaymentSettings;
  confirmation: FormConfirmationSettings;
  notifications: {
    enabled: boolean;
    recipients: string;
  };
  access: {
    mode: "public" | "password" | "authenticated";
    password: string;
  };
  limits: {
    responseLimit: number | null;
    onePerEmail: boolean;
  };
  schedule: {
    opensAt: string;
    closesAt: string;
  };
  lifecycle: "active" | "paused";
  version: number;
  versions: FormVersion[];
  liveSnapshot: FormLiveSnapshot | null;
  hasUnpublishedChanges: boolean;
  archivedFromStatus?: "draft" | "published";
};

export type FormStatus = "draft" | "published" | "archived";

export type FormRecord = {
  id: string;
  slug: string;
  projectId: string | null;
  projectName?: string | null;
  title: string;
  description: string;
  fields: FormField[];
  settings: FormSettings;
  status: FormStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  responseCount: number;
  fieldCount?: number;
  isSummary?: boolean;
};

export type FormSubmission = {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  submittedBy: string | null;
  submittedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type AutomationTriggerEvent =
  | "form_submitted"
  | "response_completed"
  | "response_partial"
  | "payment_completed";

export type AutomationActionType =
  | "send_email"
  | "notify_team"
  | "create_contact"
  | "update_contact"
  | "tag_response"
  | "create_document"
  | "webhook"
  | "slack"
  | "google_sheets"
  | "zapier"
  | "make"
  | "airtable"
  | "hubspot"
  | "mailchimp"
  | "notion";

export type AutomationAction = {
  id: string;
  type: AutomationActionType;
  name: string;
  connectionId: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
};

export type AutomationCondition = {
  id: string;
  fieldId: string;
  operator: FormLogicOperator;
  value: string;
};

export type FormWorkflow = {
  id: string;
  formId: string;
  /** Optional project grouping; null means the workflow is unassigned. */
  projectId: string | null;
  name: string;
  description: string;
  triggerEvent: AutomationTriggerEvent;
  actions: AutomationAction[];
  conditions: AutomationCondition[];
  enabled: boolean;
  runOncePerSubmission: boolean;
  runCount: number;
  successCount: number;
  failureCount: number;
  lastRunAt: string | null;
  lastRunStatus: AutomationRunStatus | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationConnection = {
  id: string;
  provider: string;
  name: string;
  authType: "oauth" | "webhook" | "endpoint";
  status: "untested" | "connected" | "error" | "disabled";
  config: Record<string, unknown>;
  externalAccountId: string | null;
  externalAccountName: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationProvider = {
  id: string;
  name: string;
  description: string;
  logoUrl: string | null;
  connectionMode: "oauth" | "webhook";
  configured: boolean;
};

export type AutomationRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type AutomationRunStep = {
  id: string;
  actionId: string | null;
  position: number;
  actionType: string;
  status: AutomationRunStatus;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type AutomationRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  formId: string;
  submissionId: string | null;
  triggerEvent: string;
  status: AutomationRunStatus;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  steps: AutomationRunStep[];
};

export type AutomationWorkflowInput = {
  name: string;
  description: string;
  triggerEvent: AutomationTriggerEvent;
  actions: AutomationAction[];
  conditions: AutomationCondition[];
  enabled: boolean;
  runOncePerSubmission: boolean;
};

export type FormPayment = {
  id: string;
  submissionId: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  paymentDate: string;
};

export type FormTemplate = {
  id: string;
  group: string;
  name: string;
  description: string;
  fields: FormField[];
  payment?: Partial<FormPaymentSettings>;
  imageUrl?: string;
};

export type FormsTab =
  | "all"
  | "templates"
  | "email_templates"
  | "ai"
  | "responses"
  | "analytics"
  | "automations"
  | "settings";

export const createId = (prefix = "item") => {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
};

export const defaultTheme = (): FormTheme => ({
  accentColor: "#F93D0A",
  accentColorMode: "workspace",
  backgroundColor: "#FFFFFF",
  containerBackgroundColor: "",
  containerBorderColor: "#E0E2E7",
  containerBorderWidth: 1,
  containerBorderStyle: "solid",
  containerBorderRadius: 6,
  pageLayout: "standard",
  textColor: "",
  fontFamily: "Inter",
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.5,
  radius: 6,
  blockStyle: {
    textColor: "",
    backgroundColor: "",
    borderColor: "",
    borderWidth: 0,
    borderRadius: 6,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
  },
  buttonStyle: "solid",
  respondentMode: "auto",
  coverImageUrl: "",
  logoUrl: "",
  preloader: defaultPreloaderSettings(),
  customCss: "",
});

export const defaultPayment = (): FormPaymentSettings => ({
  enabled: false,
  productCommerceEnabled: false,
  mode: "fixed",
  provider: "workspace",
  productId: "",
  amount: 0,
  currency: "USD",
  allowCoupons: false,
  shippingEnabled: false,
  shippingAmount: 0,
  freeShippingThreshold: 0,
  taxEnabled: false,
  taxMode: "product",
  destinationTaxRate: 0,
  taxRules: [],
    shippingMode: "flat",
    shippingRateType: "flat",
    shippingWeightUnit: "kg",
    shippingHandlingFee: 0,
    shippingPerItemAmount: 0,
    shippingPerWeightUnitAmount: 0,
    shippingPackageWeightGrams: 0,
    shippingCountryPolicy: "worldwide",
    shippingCountries: [],
    shippingDefaultDeliveryEstimate: "",
    shippingRules: [],
  });

export const defaultFormSettings = (): FormSettings => ({
  logic: [],
  theme: defaultTheme(),
  payment: defaultPayment(),
  confirmation: {
    useModuleDefault: false,
    type: "message",
    title: "Response received",
    message: "Thanks. Your response has been received.",
    redirectUrl: "",
    redirectDelay: 2,
    submitButtonLabel: "",
    buttonLabel: "",
    buttonUrl: "",
    allowAnotherResponse: false,
    showResponseSummary: false,
    icon: "check",
    accentColor: "#F93D0A",
    backgroundColor: "#FFFFFF",
    textAlign: "center",
  },
  notifications: {
    enabled: true,
    recipients: "",
  },
  access: {
    mode: "public",
    password: "",
  },
  limits: {
    responseLimit: null,
    onePerEmail: false,
  },
  schedule: {
    opensAt: "",
    closesAt: "",
  },
  lifecycle: "active",
  version: 0,
  versions: [],
  liveSnapshot: null,
  hasUnpublishedChanges: false,
});

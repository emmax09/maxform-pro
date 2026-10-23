import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Heart,
  Loader2,
  Lock,
  Mail,
  PauseCircle,
  ShieldCheck,
} from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

import { FormRenderer } from "@/components/forms/FormRenderer";
import { PublicCheckoutPanel } from "@/components/payments/PublicCheckoutPanel";
import { PublicPreloader } from "@/components/shared/PublicPreloader";
import type {
  FormConfirmationSettings,
  FormRecord,
  FormTheme,
} from "@/components/forms/form-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { usePersistentQuery } from "@/hooks/use-persistent-query";
import {
  getPublicForm,
  submitPublicForm,
  verifyPublicFormAccess,
} from "@/lib/forms";
import { recordPublicSubmissionLocation } from "@/lib/geo-address";
import { persistentCacheKey } from "@/lib/performance/indexed-cache";
import { publicThemeVariables, readableColorOn } from "@/lib/public-theme";
import {
  clearPublicCheckoutDrafts,
  createPublicCheckout,
  getPublicCheckoutOptions,
  getPublicOrderStatus,
  getPublicCheckoutQuote,
  validatePublicCheckoutCoupon,
  type PublicCheckoutCouponQuote,
  type PublicCheckoutCustomerDetails,
  type PublicCheckoutOptions,
  type PublicCheckoutQuote,
  type PublicEventAccess,
} from "@/lib/checkout";

type UnavailableState = {
  icon: typeof AlertCircle;
  title: string;
  description: string;
};

// Neutral, non-branded placeholder - never the "wrong" brand color, just a
// placeholder shown only until the form's real theme is known.
const neutralAccent = "#707077";

const formShellStyle = (theme?: FormTheme) => {
  const background = theme?.backgroundColor || "#FFFFFF";
  const containerBackground = theme?.containerBackgroundColor || background;
  const accent = theme?.accentColor || neutralAccent;
  const text = theme?.textColor || "#17181A";
  const border =
    theme?.containerBorderColor || theme?.blockStyle?.borderColor || "#E0E2E7";
  const muted = text.toUpperCase() === "#FFFFFF" ? "#D8DADE" : "#666A73";
  const surface = containerBackground;
  const radius = `${theme?.containerBorderRadius ?? theme?.radius ?? 6}px`;
  return {
    accent,
    background,
    border,
    fontFamily: theme?.fontFamily ? `${theme.fontFamily}, sans-serif` : undefined,
    muted,
    text,
    vars: {
      ...publicThemeVariables({
        accent,
        background,
        border,
        foreground: text,
        muted,
        radius,
        surface,
      }),
      "--form-accent": accent,
      "--form-bg": containerBackground,
      "--form-page-bg": background,
      "--form-fg": text,
      "--form-muted": muted,
      "--form-border": border,
      "--form-surface": surface,
      "--form-radius": radius,
    } as CSSProperties,
  };
};

const responseSummaryText = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value && typeof value === "object") {
    const answer = value as Record<string, unknown>;
    if (answer.kind === "file") {
      return typeof answer.fileName === "string"
        ? answer.fileName
        : "File attached";
    }
    if (answer.kind === "signature") return "Signature captured";
  }
  return String(value ?? "");
};

const emptyCheckoutCustomer = (): PublicCheckoutCustomerDetails => ({
  addressLine1: "",
  addressLine2: "",
  city: "",
  country: "",
  email: "",
  firstName: "",
  lastName: "",
  phone: "",
  postalCode: "",
  region: "",
});

const validCheckoutEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const checkoutCustomerComplete = (customer: PublicCheckoutCustomerDetails) =>
  Boolean(
    customer.firstName.trim() &&
      customer.lastName.trim() &&
      validCheckoutEmail(customer.email) &&
      customer.addressLine1.trim() &&
      customer.city.trim() &&
      customer.region.trim() &&
      customer.postalCode.trim() &&
      customer.country.trim(),
  );

const hasCheckoutCustomerDraft = (customer: PublicCheckoutCustomerDetails) =>
  Object.values(customer).some((value) => value.trim().length > 0);

type CheckoutDraft = {
  checkoutActive: boolean;
  checkoutCustomer: PublicCheckoutCustomerDetails;
  checkoutKey: string;
  couponAdded: boolean;
  couponCode: string;
  pendingSubmissionId: string;
  pendingSubmissionKey: string;
  selectedProvider: string;
  submittedAnswers: Record<string, unknown>;
  variableAmount: number;
};

type CouponValidationStatus = "idle" | "checking" | "valid" | "invalid";

const checkoutDraftKey = (form: FormRecord) =>
  `maxform:checkout-draft:${form.id}:${form.settings.version}`;

const publicSubmissionKeyStorageKey = (form: FormRecord) =>
  `maxform:public-submission:${form.id}:${form.settings.version}`;

const getOrCreatePublicSubmissionKey = (
  form: FormRecord,
  currentKey = "",
) => {
  if (currentKey) return currentKey;
  const storageKey = publicSubmissionKeyStorageKey(form);
  try {
    const existing = window.sessionStorage.getItem(storageKey) || "";
    if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
};

const clearPublicSubmissionKey = (form: FormRecord) => {
  try {
    window.sessionStorage.removeItem(publicSubmissionKeyStorageKey(form));
  } catch {
    // Session storage is optional; checkout idempotency still works in-session.
  }
};

const readCheckoutDraft = (form: FormRecord): CheckoutDraft | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(checkoutDraftKey(form));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CheckoutDraft>;
    return {
      checkoutActive: parsed.checkoutActive === true,
      checkoutCustomer: {
        ...emptyCheckoutCustomer(),
        ...(parsed.checkoutCustomer || {}),
      },
      checkoutKey: String(parsed.checkoutKey || ""),
      couponAdded: parsed.couponAdded === true,
      couponCode: String(parsed.couponCode || ""),
      pendingSubmissionId: String(parsed.pendingSubmissionId || ""),
      pendingSubmissionKey: String(parsed.pendingSubmissionKey || ""),
      selectedProvider: String(parsed.selectedProvider || ""),
      submittedAnswers:
        parsed.submittedAnswers && typeof parsed.submittedAnswers === "object"
          ? parsed.submittedAnswers
          : {},
      variableAmount: Number(parsed.variableAmount || 0),
    };
  } catch {
    return null;
  }
};

function MessageScreen({
  description,
  icon: Icon,
  theme,
  title,
}: UnavailableState & { theme?: FormTheme }) {
  const shell = formShellStyle(theme);
  return (
    <div
      className="flex min-h-screen items-center justify-center px-5"
      style={{
        ...shell.vars,
        backgroundColor: shell.background,
        color: shell.text,
        fontFamily: shell.fontFamily,
      }}
    >
      <div
        className="w-full max-w-[480px] border-y py-12 text-center"
        style={{ borderColor: shell.border }}
      >
        <Icon className="mx-auto h-6 w-6" style={{ color: shell.accent }} />
        <h1 className="mt-5 text-[22px] font-semibold">{title}</h1>
        <p
          className="mx-auto mt-2 max-w-[380px] text-[13px] leading-6"
          style={{ color: shell.muted }}
        >
          {description}
        </p>
      </div>
    </div>
  );
}

const CHECKOUT_REDIRECT_DELAY_MS = 4000;

function CheckoutRedirectOverlay({
  theme,
  workspaceLogoUrl,
}: {
  theme?: FormTheme;
  workspaceLogoUrl?: string;
}) {
  const shell = formShellStyle(theme);
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-5 text-center"
      style={{
        ...shell.vars,
        backgroundColor: shell.background,
        color: shell.text,
        fontFamily: shell.fontFamily,
      }}
    >
      {workspaceLogoUrl ? (
        <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-white p-2" style={{ borderColor: shell.border }}>
          <img
            src={workspaceLogoUrl}
            alt=""
            className="h-full w-full object-contain"
          />
        </span>
      ) : (
        <span
          className="flex h-14 w-14 items-center justify-center rounded-md"
          style={{
            backgroundColor: shell.accent,
            color: readableColorOn(shell.accent),
          }}
        >
          <ShieldCheck className="h-7 w-7" />
        </span>
      )}
      <Loader2
        className="h-6 w-6 animate-spin"
        style={{ color: shell.accent }}
      />
      <p className="text-[16px] font-semibold">Redirecting to secure checkout</p>
    </div>
  );
}

function ConfirmationScreen({
  answers,
  confirmation,
  eventAccess,
  form,
  onSubmitAnother,
}: {
  answers: Record<string, unknown>;
  confirmation: FormConfirmationSettings;
  eventAccess: PublicEventAccess | null;
  form: FormRecord;
  onSubmitAnother: () => void;
}) {
  const icons = {
    check: CheckCircle2,
    mail: Mail,
    heart: Heart,
    none: Check,
  };
  const Icon = icons[confirmation.icon];
  const redirecting = confirmation.type !== "message";
  const shell = formShellStyle(form.settings.theme);
  const confirmationAccent = confirmation.accentColor || shell.accent;
  const summary = form.fields
    .filter((field) => answers[field.id] != null && answers[field.id] !== "")
    .map((field) => ({
      id: field.id,
      label: field.label,
      value: responseSummaryText(answers[field.id]),
    }));

  return (
    <div
      className="flex min-h-screen items-center px-5 py-12"
      style={{
        ...shell.vars,
        backgroundColor: confirmation.backgroundColor || shell.background,
        color: shell.text,
        fontFamily: shell.fontFamily,
      }}
    >
      <main
        className={confirmation.textAlign === "center" ? "mx-auto w-full max-w-[600px] text-center" : "mx-auto w-full max-w-[600px] text-left"}
      >
        {confirmation.icon !== "none" && (
          <span
            className={confirmation.textAlign === "center" ? "mx-auto flex h-12 w-12 items-center justify-center rounded-md" : "flex h-12 w-12 items-center justify-center rounded-md"}
            style={{
              backgroundColor: `${confirmationAccent}18`,
              color: confirmationAccent,
            }}
          >
            <Icon className="h-6 w-6" />
          </span>
        )}
        <h1 className="mt-6 text-[28px] font-semibold leading-tight">
          {confirmation.type === "redirect"
            ? "Taking you to the next page"
            : confirmation.title || "Response received"}
        </h1>
        <p
          className="mt-3 text-[14px] leading-6"
          style={{ color: shell.muted }}
        >
          {confirmation.type === "redirect"
            ? "Your response has been saved."
            : confirmation.message}
        </p>

        {redirecting && (
          <p
            className={confirmation.textAlign === "center" ? "mt-5 flex items-center justify-center gap-2 text-[12px]" : "mt-5 flex items-center gap-2 text-[12px]"}
            style={{ color: shell.muted }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {confirmation.type === "message_redirect"
              ? `Redirecting in ${confirmation.redirectDelay} seconds`
              : "Redirecting now"}
          </p>
        )}

        {confirmation.showResponseSummary && summary.length > 0 && (
          <div
            className="mt-8 border-y py-2 text-left"
            style={{ borderColor: shell.border }}
          >
            {summary.map((answer) => (
              <div
                key={answer.id}
                className="grid gap-1 border-b py-3 last:border-b-0 sm:grid-cols-[180px_minmax(0,1fr)]"
                style={{ borderColor: shell.border }}
              >
                <span
                  className="text-[11px] font-medium"
                  style={{ color: shell.muted }}
                >
                  {answer.label}
                </span>
                <span
                  className="break-words text-[12px]"
                  style={{ color: shell.text }}
                >
                  {answer.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {eventAccess?.joinUrl && (
          <div
            className="mt-8 border p-5 text-left"
            style={{
              borderColor: shell.border,
              backgroundColor: `${shell.accent}0A`,
            }}
          >
            <p className="text-[13px] font-semibold">Your online access</p>
            <p className="mt-1 text-[12px] leading-5" style={{ color: shell.muted }}>
              {eventAccess.meetingProvider || "Online meeting"} for {eventAccess.eventTitle}. Keep this link private.
            </p>
            <a
              href={eventAccess.joinUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-[12px] font-semibold underline underline-offset-4"
              style={{ color: shell.accent }}
            >
              Open meeting link
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}

        <div
          className={confirmation.textAlign === "center" ? "mt-8 flex flex-wrap justify-center gap-3" : "mt-8 flex flex-wrap gap-3"}
        >
          {confirmation.buttonLabel && confirmation.buttonUrl && (
            <Button
              asChild
              style={{
                backgroundColor: confirmationAccent,
                color: readableColorOn(confirmationAccent),
              }}
            >
              <a href={confirmation.buttonUrl}>
                {confirmation.buttonLabel}
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          {confirmation.allowAnotherResponse && (
            <Button
              type="button"
              variant="outline"
              onClick={onSubmitAnother}
              className="bg-transparent hover:bg-transparent"
              style={{ borderColor: shell.border, color: shell.text }}
            >
              Submit another response
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}

export default function PublicForm() {
  const { formId, formSlug, workspaceId } = useParams();
  const [searchParams] = useSearchParams();
  const formIdentifier = formSlug || formId;
  const paymentAttemptKey = searchParams.get("payment_attempt")?.trim() || "";
  const { user } = useAuth();
  const [form, setForm] = useState<FormRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [completedPreloaderKey, setCompletedPreloaderKey] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [password, setPassword] = useState("");
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [accessError, setAccessError] = useState("");
  const [accessVerifying, setAccessVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutRedirecting, setCheckoutRedirecting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedAnswers, setSubmittedAnswers] = useState<
    Record<string, unknown>
  >({});
  const [submittedEventAccess, setSubmittedEventAccess] =
    useState<PublicEventAccess | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [checkoutOptions, setCheckoutOptions] =
    useState<PublicCheckoutOptions | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [variableAmount, setVariableAmount] = useState(0);
  const [pendingSubmissionId, setPendingSubmissionId] = useState("");
  const [pendingSubmissionKey, setPendingSubmissionKey] = useState("");
  const [checkoutKey, setCheckoutKey] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponAdded, setCouponAdded] = useState(false);
  const [couponQuote, setCouponQuote] =
    useState<PublicCheckoutCouponQuote | null>(null);
  const [checkoutQuote, setCheckoutQuote] =
    useState<PublicCheckoutQuote | null>(null);
  const [checkoutQuoteLoading, setCheckoutQuoteLoading] = useState(false);
  const [couponValidationError, setCouponValidationError] = useState("");
  const [couponValidationStatus, setCouponValidationStatus] =
    useState<CouponValidationStatus>("idle");
  const [checkoutCustomer, setCheckoutCustomer] =
    useState<PublicCheckoutCustomerDetails>(() => emptyCheckoutCustomer());
  const [checkoutActive, setCheckoutActive] = useState(false);
  const [paymentConfirmationState, setPaymentConfirmationState] = useState<
    "idle" | "checking" | "confirmed" | "invalid"
  >(() => (paymentAttemptKey ? "checking" : "idle"));
  const formQuery = usePersistentQuery<FormRecord | null>({
    cacheKey: persistentCacheKey(
      "forms",
      "public",
      workspaceId ? `${workspaceId}:${formIdentifier}` : formIdentifier,
    ),
    cacheScope: "forms",
    enabled: Boolean(formIdentifier),
    persist: false,
    queryFn: () => getPublicForm(formIdentifier!, workspaceId),
    queryKey: [
      "forms",
      "public",
      workspaceId || "__none",
      formIdentifier || "__none",
    ],
    refetchOnMount: "always",
    staleTime: 0,
    tags: ["forms", "public-forms"],
  });

  const clearCompletedCheckout = useCallback((completedFormId: string) => {
    clearPublicCheckoutDrafts(completedFormId);
    setCheckoutActive(false);
    setCheckoutRedirecting(false);
    setPendingSubmissionId("");
    setPendingSubmissionKey("");
    setCheckoutKey("");
    setCouponCode("");
    setCouponAdded(false);
    setCouponQuote(null);
    setCheckoutQuote(null);
    setCheckoutQuoteLoading(false);
    setCouponValidationError("");
    setCouponValidationStatus("idle");
    setSelectedProvider("");
    setVariableAmount(0);
    setCheckoutCustomer(emptyCheckoutCustomer());
  }, []);
  const checkoutOptionsQuery = usePersistentQuery<PublicCheckoutOptions | null>({
    cacheKey: persistentCacheKey("forms", "public-checkout", form?.id),
    cacheScope: "payments",
    enabled: Boolean(form?.id),
    persist: false,
    queryFn: async () => {
      if (!form) return null;
      try {
        return await getPublicCheckoutOptions(form.id);
      } catch {
        return {
          enabled: form.settings.payment.enabled,
          // Do not display a coupon control unless the checkout server has
          // explicitly confirmed that this live form or event accepts it.
          allowCoupons: false,
          mode: form.settings.payment.mode,
          amount: form.settings.payment.amount,
          currency: form.settings.payment.currency,
          providers: [],
          workspace: {
            accentColor: form.settings.theme.accentColor,
            logoUrl: "",
            name: "Secure checkout",
          },
        } satisfies PublicCheckoutOptions;
      }
    },
    queryKey: ["forms", "public-checkout", form?.id || "__none"],
    refetchOnMount: "always",
    staleTime: 0,
    tags: ["forms", "payments", "public-checkout"],
  });

  useEffect(() => {
    if (!formIdentifier) {
      setLoading(false);
      return;
    }
    if (formQuery.data !== undefined) {
      setForm(formQuery.data);
      setLoadFailed(false);
      setLoading(false);
      return;
    }
    if (formQuery.isError) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    setLoading(formQuery.isInitialLoading);
  }, [
    formIdentifier,
    formQuery.data,
    formQuery.isError,
    formQuery.isInitialLoading,
  ]);

  const preloader = form?.settings.theme.preloader;
  const preloaderKey =
    form && preloader?.enabled && Number(preloader.durationSeconds) > 0
      ? `${form.id}:${preloader.durationSeconds}`
      : "";
  const showingPreloader = Boolean(
    preloaderKey && completedPreloaderKey !== preloaderKey,
  );

  useEffect(() => {
    if (!preloaderKey || !preloader) return;
    const timeout = window.setTimeout(
      () => setCompletedPreloaderKey(preloaderKey),
      Math.min(30, Math.max(0, Number(preloader.durationSeconds))) * 1_000,
    );
    return () => window.clearTimeout(timeout);
  }, [preloader, preloaderKey]);

  useEffect(() => {
    if (!form) {
      setCheckoutOptions(null);
      setCheckoutLoading(false);
      return;
    }
    if (checkoutOptionsQuery.data !== undefined) {
      const options = checkoutOptionsQuery.data;
      setCheckoutOptions(options);
      setVariableAmount((current) =>
        options?.mode === "variable" ? current : options?.amount || 0,
      );
      setSelectedProvider((current) =>
        options?.providers.some((provider) => provider.id === current)
          ? current
          : options && options.providers.length === 1
            ? options.providers[0].id
            : "",
      );
      setCheckoutLoading(false);
      return;
    }
    setCheckoutLoading(checkoutOptionsQuery.isInitialLoading);
  }, [
    checkoutOptionsQuery.data,
    checkoutOptionsQuery.isInitialLoading,
    form,
  ]);

  useEffect(() => {
    if (checkoutOptions?.allowCoupons !== false) return;
    setCouponCode("");
    setCouponAdded(false);
    setCouponQuote(null);
    setCouponValidationError("");
    setCouponValidationStatus("idle");
  }, [checkoutOptions?.allowCoupons]);

  useEffect(() => {
    let active = true;
    if (!form) return;
    const draft = readCheckoutDraft(form);
    const applyDraft = () => {
      if (!active) return;
      setCheckoutActive(Boolean(draft?.checkoutActive && draft.pendingSubmissionId));
      setCheckoutCustomer(draft?.checkoutCustomer || emptyCheckoutCustomer());
      setPendingSubmissionId(draft?.pendingSubmissionId || "");
      setPendingSubmissionKey(draft?.pendingSubmissionKey || "");
      setCheckoutKey(draft?.checkoutKey || "");
      setCouponCode(draft?.couponCode || "");
      setCouponAdded(draft?.couponAdded || false);
      setSelectedProvider(draft?.selectedProvider || "");
      setVariableAmount(draft?.variableAmount || 0);
      setSubmittedAnswers(draft?.submittedAnswers || {});
    };
    if (!draft?.checkoutKey || !draft.pendingSubmissionId) {
      applyDraft();
      return () => {
        active = false;
      };
    }
    void getPublicOrderStatus(draft.checkoutKey)
      .then((order) => {
        if (!active) return;
        if (order.status === "confirmed" && order.form?.id === form.id) {
          clearCompletedCheckout(form.id);
          return;
        }
        applyDraft();
      })
      .catch(applyDraft);
    return () => {
      active = false;
    };
  }, [clearCompletedCheckout, form]);

  const activeFormId = form?.id || "";

  useEffect(() => {
    let active = true;
    if (!activeFormId || !paymentAttemptKey) {
      setPaymentConfirmationState("idle");
      return;
    }
    setPaymentConfirmationState("checking");
    void getPublicOrderStatus(paymentAttemptKey)
      .then((order) => {
        if (!active) return;
        if (order.status !== "confirmed" || order.form?.id !== activeFormId) {
          setPaymentConfirmationState("invalid");
          return;
        }
        clearCompletedCheckout(activeFormId);
        setSubmittedAnswers({});
        setSubmitted(true);
        setPaymentConfirmationState("confirmed");
      })
      .catch(() => {
        if (active) setPaymentConfirmationState("invalid");
      });
    return () => {
      active = false;
    };
  }, [activeFormId, clearCompletedCheckout, paymentAttemptKey]);

  useEffect(() => {
    if (submitted && form) clearCompletedCheckout(form.id);
  }, [clearCompletedCheckout, form, submitted]);

  useEffect(() => {
    if (!submitted || !form) return;
    const confirmation = form.settings.confirmation;
    if (confirmation.type === "message" || !confirmation.redirectUrl) return;
    const delay =
      confirmation.type === "redirect"
        ? 100
        : Math.max(0, confirmation.redirectDelay) * 1_000;
    const timeout = window.setTimeout(
      () => window.location.assign(confirmation.redirectUrl),
      delay,
    );
    return () => window.clearTimeout(timeout);
  }, [form, submitted]);

  const normalizedCouponCode = couponCode.trim().toUpperCase();
  const checkoutEnabled = Boolean(
    form?.settings.payment.enabled || checkoutOptions?.enabled,
  );
  const eventCheckoutLikely = Boolean(
    form?.fields.some((field) => field.id === "ticket-selection"),
  );
  const validateCouponNow = useCallback(async () => {
    if (!normalizedCouponCode) {
      setCouponAdded(false);
      setCouponQuote(null);
      setCouponValidationError("Enter a coupon code to validate.");
      setCouponValidationStatus("invalid");
      return null;
    }
    if (normalizedCouponCode.length < 3) {
      setCouponAdded(false);
      setCouponQuote(null);
      setCouponValidationError("Enter the full coupon code.");
      setCouponValidationStatus("invalid");
      return null;
    }
    if (!checkoutActive || !checkoutEnabled || !form) {
      setCouponAdded(false);
      setCouponQuote(null);
      setCouponValidationError("Complete the form before applying a coupon.");
      setCouponValidationStatus("invalid");
      return null;
    }
    if (!pendingSubmissionId) {
      setCouponAdded(false);
      setCouponQuote(null);
      setCouponValidationError("Complete the form before applying a coupon.");
      setCouponValidationStatus("invalid");
      return null;
    }
    if (!checkoutOptions?.allowCoupons) {
      setCouponAdded(false);
      setCouponQuote(null);
      setCouponValidationError("Coupons are not available for this checkout.");
      setCouponValidationStatus("invalid");
      return null;
    }
    if (checkoutOptions.mode === "variable" && variableAmount <= 0) {
      setCouponAdded(false);
      setCouponQuote(null);
      setCouponValidationError("Enter a payment amount before applying a coupon.");
      setCouponValidationStatus("invalid");
      return null;
    }

    setCouponAdded(false);
    setCouponQuote(null);
    setCouponValidationError("");
    setCouponValidationStatus("checking");
    try {
      const quote = await validatePublicCheckoutCoupon({
        amount:
          checkoutOptions.mode === "variable" ? variableAmount : undefined,
        couponCode: normalizedCouponCode,
        formId: form.id,
        submissionId: pendingSubmissionId,
        customer: checkoutCustomer,
      });
      setCouponQuote(quote);
      setCouponAdded(true);
      setCouponValidationError("");
      setCouponValidationStatus("valid");
      return quote;
    } catch (error) {
      setCouponQuote(null);
      setCouponAdded(false);
      setCouponValidationError(
        error instanceof Error
          ? error.message
          : "This coupon is not valid for this checkout.",
      );
      setCouponValidationStatus("invalid");
      return null;
    }
  }, [
    checkoutActive,
    checkoutEnabled,
    checkoutCustomer,
    checkoutOptions,
    form,
    normalizedCouponCode,
    pendingSubmissionId,
    variableAmount,
  ]);

  useEffect(() => {
    if (!checkoutActive || !checkoutEnabled || !form || !pendingSubmissionId) {
      setCheckoutQuote(null);
      setCheckoutQuoteLoading(false);
      return;
    }
    if (!checkoutOptions?.enabled) {
      setCheckoutQuote(null);
      setCheckoutQuoteLoading(false);
      return;
    }
    if (checkoutOptions.mode === "variable" && variableAmount <= 0) {
      setCheckoutQuote(null);
      setCheckoutQuoteLoading(false);
      return;
    }

    let cancelled = false;
    setCheckoutQuoteLoading(true);
    const timeout = window.setTimeout(() => {
      void getPublicCheckoutQuote({
        amount:
          checkoutOptions.mode === "variable" ? variableAmount : undefined,
        formId: form.id,
        submissionId: pendingSubmissionId,
        customer: checkoutCustomer,
      })
        .then((quote) => {
          if (cancelled) return;
          setCheckoutQuote(quote);
        })
        .catch((error) => {
          if (cancelled) return;
          setCheckoutQuote(null);
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Checkout amount could not be prepared.",
          );
        })
        .finally(() => {
          if (!cancelled) setCheckoutQuoteLoading(false);
        });
    }, checkoutOptions.mode === "variable" ? 300 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    checkoutActive,
    checkoutEnabled,
    checkoutCustomer,
    checkoutOptions,
    form,
    pendingSubmissionId,
    variableAmount,
  ]);

  useEffect(() => {
    if (!form || typeof window === "undefined") return;
    const key = checkoutDraftKey(form);
    const hasDraft =
      checkoutActive ||
      Boolean(pendingSubmissionId) ||
      Boolean(checkoutKey) ||
      couponAdded ||
      Boolean(couponCode.trim()) ||
      Boolean(selectedProvider) ||
      variableAmount > 0 ||
      hasCheckoutCustomerDraft(checkoutCustomer);
    if ((!checkoutEnabled && !checkoutOptionsQuery.isInitialLoading) || !hasDraft) {
      window.localStorage.removeItem(key);
      return;
    }
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          checkoutActive,
          checkoutCustomer,
          checkoutKey,
          couponAdded,
          couponCode,
          pendingSubmissionId,
          pendingSubmissionKey,
          selectedProvider,
          submittedAnswers,
          updatedAt: Date.now(),
          variableAmount,
        }),
      );
    } catch {
      // The checkout remains usable if browser storage is unavailable.
    }
  }, [
    checkoutActive,
    checkoutCustomer,
    checkoutKey,
    checkoutEnabled,
    checkoutOptionsQuery.isInitialLoading,
    couponAdded,
    couponCode,
    form,
    pendingSubmissionId,
    pendingSubmissionKey,
    selectedProvider,
    submittedAnswers,
    variableAmount,
  ]);

  const unavailable = useMemo<UnavailableState | null>(() => {
    if (!form) {
      return {
        icon: AlertCircle,
        title: "This form is not available",
        description:
          "The form may be unpublished, deleted, or the link may be incorrect.",
      };
    }
    if (form.settings.lifecycle === "paused") {
      return {
        icon: PauseCircle,
        title: "This form is paused",
        description:
          "The owner has temporarily stopped accepting responses. The link remains valid.",
      };
    }
    const now = Date.now();
    if (
      form.settings.schedule.opensAt &&
      new Date(form.settings.schedule.opensAt).getTime() > now
    ) {
      return {
        icon: Clock3,
        title: "This form is not open yet",
        description: `Responses open ${new Date(
          form.settings.schedule.opensAt,
        ).toLocaleString()}.`,
      };
    }
    if (
      form.settings.schedule.closesAt &&
      new Date(form.settings.schedule.closesAt).getTime() < now
    ) {
      return {
        icon: Clock3,
        title: "This form is now closed",
        description: "The submission window has ended.",
      };
    }
    if (
      form.settings.limits.responseLimit &&
      form.responseCount >= form.settings.limits.responseLimit
    ) {
      return {
        icon: CheckCircle2,
        title: "This form has reached capacity",
        description:
          "The response limit has been reached and new submissions are closed.",
      };
    }
    if (form.settings.access.mode === "authenticated" && !user) {
      return {
        icon: Lock,
        title: "Sign in is required",
        description:
          "This form is limited to authenticated contacts. Sign in to continue.",
      };
    }
    return null;
  }, [form, user]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-white" aria-label="Loading form" />
    );
  }

  if (loadFailed) {
    return (
      <MessageScreen
        icon={AlertCircle}
        title="The form could not be loaded"
        description="Check your connection and try opening the link again."
      />
    );
  }

  if (!form) return null;
  const shell = formShellStyle(form.settings.theme);
  if (showingPreloader) {
    return <PublicPreloader settings={form.settings.theme.preloader} />;
  }
  if (paymentConfirmationState === "checking") {
    return (
      <div
        className="flex min-h-dvh items-center justify-center px-5 text-center"
        style={{
          ...shell.vars,
          backgroundColor: shell.background,
          color: shell.text,
          fontFamily: shell.fontFamily,
        }}
      >
        <p className="text-[13px]" style={{ color: shell.muted }}>
          Opening your confirmation…
        </p>
      </div>
    );
  }
  if (submitted) {
    return (
      <ConfirmationScreen
        answers={submittedAnswers}
        confirmation={form.settings.confirmation}
        eventAccess={submittedEventAccess}
        form={form}
        onSubmitAnother={() => {
          clearPublicSubmissionKey(form);
          clearCompletedCheckout(form.id);
          setSubmitted(false);
          setSubmittedAnswers({});
          setSubmittedEventAccess(null);
        }}
      />
    );
  }
  if (unavailable) {
    return <MessageScreen {...unavailable} theme={form.settings.theme} />;
  }
  const customerComplete = checkoutCustomerComplete(checkoutCustomer);
  const couponCoversTotal = Boolean(
    couponValidationStatus === "valid" && couponQuote && couponQuote.total <= 0,
  );
  const checkoutNeedsPayment =
    !couponCoversTotal &&
    (checkoutQuote?.paymentRequired !== false || (checkoutQuote?.total || 0) > 0);
  const checkoutUnavailable =
    checkoutEnabled &&
    (!checkoutOptions?.enabled ||
      (checkoutNeedsPayment && checkoutOptions.providers.length === 0) ||
      (checkoutOptions.mode === "variable" && variableAmount <= 0) ||
      checkoutQuoteLoading ||
      (checkoutNeedsPayment && !selectedProvider) ||
      (checkoutNeedsPayment && !customerComplete) ||
      couponValidationStatus === "checking");

  const startCheckout = async (event?: FormEvent) => {
    event?.preventDefault();
    if (submitting || !checkoutEnabled) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      if (!pendingSubmissionId) {
        throw new Error("Complete the form before continuing to payment.");
      }
      if (!checkoutOptions?.enabled) {
        throw new Error("Choose an available payment method to continue.");
      }
      if (checkoutOptions.mode === "variable" && variableAmount <= 0) {
        throw new Error("Enter a payment amount before continuing to payment.");
      }
      let appliedCouponQuote =
        couponValidationStatus === "valid" ? couponQuote : null;
      if (normalizedCouponCode && !appliedCouponQuote) {
        appliedCouponQuote = await validateCouponNow();
        if (!appliedCouponQuote) return;
      }
      const couponPaysFull = Boolean(
        appliedCouponQuote && appliedCouponQuote.total <= 0,
      );
      const paymentRequired =
        !couponPaysFull &&
        (checkoutQuote?.paymentRequired !== false ||
          (checkoutQuote?.total || 0) > 0);
      if (paymentRequired && !checkoutCustomerComplete(checkoutCustomer)) {
        throw new Error(
          "Complete the billing contact and address before continuing to payment.",
        );
      }
      if (paymentRequired && !selectedProvider) {
        throw new Error("Choose an available payment method to continue.");
      }
      const nextKey = checkoutKey || crypto.randomUUID();
      if (!checkoutKey) setCheckoutKey(nextKey);
      const checkout = await createPublicCheckout({
        amount:
          checkoutOptions.mode === "variable" ? variableAmount : undefined,
        couponCode: appliedCouponQuote?.coupon.code || undefined,
        formId: form.id,
        idempotencyKey: nextKey,
        customer: checkoutCustomer,
        provider: paymentRequired
          ? (selectedProvider as "stripe" | "paypal" | "paystack" | "opay")
          : undefined,
        submissionId: pendingSubmissionId,
      });
      if (checkout.checkoutUrl) {
        window.location.assign(checkout.checkoutUrl);
        return;
      }
      clearCompletedCheckout(form.id);
      setSubmitted(true);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Checkout could not be started.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (
    form.settings.access.mode === "password" &&
    !accessGranted
  ) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-5"
        style={{
          ...shell.vars,
          backgroundColor: shell.background,
          color: shell.text,
          fontFamily: shell.fontFamily,
        }}
      >
        <div
          className="w-full max-w-[420px] border-y py-10"
          style={{ borderColor: shell.border }}
        >
          <Lock className="h-5 w-5" style={{ color: shell.accent }} />
          <h1 className="mt-5 text-[22px] font-semibold">Password required</h1>
          <p className="mt-2 text-[13px]" style={{ color: shell.muted }}>
            Enter the password shared by the form owner.
          </p>
          <form
            className="mt-6 space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (accessVerifying) return;
              setAccessError("");
              setAccessVerifying(true);
              try {
                const result = await verifyPublicFormAccess(form.id, password);
                setAccessToken(result.accessToken);
                setAccessGranted(true);
                setPassword("");
              } catch (error) {
                setAccessGranted(false);
                setAccessToken("");
                setAccessError(
                  error instanceof Error
                    ? error.message
                    : "That password could not be verified.",
                );
              } finally {
                setAccessVerifying(false);
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="public-form-password">Password</Label>
              <Input
                id="public-form-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(accessError)}
                required
              />
            </div>
            {accessError && (
              <p className="text-[12px] text-destructive" role="alert">
                {accessError}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              loading={accessVerifying}
              loadingLabel="Checking password"
              style={{
                backgroundColor: shell.accent,
                color: readableColorOn(shell.accent),
              }}
            >
              Open form
            </Button>
          </form>
        </div>
      </div>
    );
  }

  if (checkoutRedirecting) {
    return (
      <CheckoutRedirectOverlay
        theme={form.settings.theme}
        workspaceLogoUrl={checkoutOptions?.workspace.logoUrl}
      />
    );
  }

  if (checkoutActive && checkoutEnabled) {
    return (
      <div
        className="min-h-screen"
        style={{
          ...shell.vars,
          backgroundColor: shell.background,
          color: shell.text,
          fontFamily: shell.fontFamily,
        }}
      >
        <header className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-4 px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            {checkoutOptions?.workspace.logoUrl ? (
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white p-1"
                style={{ borderColor: shell.border }}
              >
                <img
                  src={checkoutOptions.workspace.logoUrl}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </span>
            ) : (
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{
                  backgroundColor:
                    checkoutOptions?.workspace.accentColor || shell.accent,
                }}
              />
            )}
            <span className="truncate text-[14px] font-semibold">
              {checkoutOptions?.workspace.name || form.title}
            </span>
          </div>
          <span
            className="hidden text-[12px] sm:inline"
            style={{ color: shell.muted }}
          >
            Secure checkout
          </span>
        </header>
        <main className="px-3 pb-14 pt-4 sm:px-6 sm:pt-8">
          <form
            className="mx-auto w-full max-w-[1120px]"
            onSubmit={(event) => void startCheckout(event)}
          >
            <div className="mb-6 max-w-[720px]">
              <Button
                type="button"
                variant="outline"
                className="mb-6 h-12 gap-3 rounded-full bg-transparent px-5 text-[14px] font-semibold shadow-sm transition hover:bg-[color-mix(in_srgb,var(--form-fg)_6%,transparent)] hover:text-inherit"
                onClick={() => {
                  setCheckoutActive(false);
                  setCheckoutKey("");
                  setCheckoutQuote(null);
                  setSubmitError("");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                style={{ borderColor: shell.border, color: shell.text }}
              >
                <ArrowLeft className="h-5 w-5" />
                Go back to edit submission
              </Button>
              <p
                className="text-[11px] font-semibold uppercase"
                style={{ color: shell.muted }}
              >
                Checkout
              </p>
              <h1 className="mt-2 text-[28px] font-semibold leading-tight">
                Complete payment
              </h1>
              <p
                className="mt-2 max-w-[560px] text-[13px] leading-6"
                style={{ color: shell.muted }}
              >
                Review your details if needed, then complete payment. Your
                response will be recorded only after payment is confirmed.
              </p>
            </div>
            <PublicCheckoutPanel
              checkoutUnavailable={checkoutUnavailable}
              couponCode={couponCode}
              couponQuote={couponQuote}
              couponValidationError={couponValidationError}
              couponValidationStatus={couponValidationStatus}
              checkoutQuote={checkoutQuote}
              checkoutQuoteLoading={checkoutQuoteLoading}
              customer={checkoutCustomer}
              customerComplete={customerComplete}
              loading={checkoutLoading}
              onCouponCodeChange={(code) => {
                setCouponCode(code);
                setCouponAdded(false);
                setCouponQuote(null);
                setCouponValidationError("");
                setCouponValidationStatus("idle");
              }}
              onCouponRemove={() => {
                setCouponCode("");
                setCouponAdded(false);
                setCouponQuote(null);
                setCouponValidationError("");
                setCouponValidationStatus("idle");
              }}
              onCouponValidate={() => void validateCouponNow()}
              onCustomerChange={setCheckoutCustomer}
              onProviderChange={setSelectedProvider}
              onVariableAmountChange={(amount) => {
                setVariableAmount(amount);
                if (couponQuote || couponValidationStatus === "valid") {
                  setCouponAdded(false);
                  setCouponQuote(null);
                  setCouponValidationError(
                    normalizedCouponCode
                      ? "Validate the coupon again for the updated amount."
                      : "",
                  );
                  setCouponValidationStatus(
                    normalizedCouponCode ? "invalid" : "idle",
                  );
                }
              }}
              options={checkoutOptions}
              selectedProvider={selectedProvider}
              submitButtonStyle={{
                backgroundColor: shell.accent,
                color: readableColorOn(shell.accent),
              }}
              submitting={submitting}
              variableAmount={variableAmount}
            />
            {submitError && (
              <div
                className="mt-4 border p-3 text-[12px]"
                style={{
                  backgroundColor: "rgba(220,38,38,0.08)",
                  borderColor: "rgba(220,38,38,0.28)",
                  color: "#d73737",
                }}
              >
                {submitError}
              </div>
            )}
          </form>
        </main>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{
        ...shell.vars,
        backgroundColor: shell.background,
        color: shell.text,
        fontFamily: shell.fontFamily,
      }}
    >
      <main className="px-3 pb-14 pt-4 sm:px-6 sm:pt-8">
        <FormRenderer
          checkoutSummary={
            checkoutOptions?.enabled &&
            checkoutOptions.mode === "fixed" &&
            checkoutOptions.amount > 0 &&
            !eventCheckoutLikely
              ? {
                  amount: checkoutOptions.amount,
                  currency: checkoutOptions.currency,
                  label: "Registration price",
                }
              : undefined
          }
          couponsEnabled={checkoutOptions?.allowCoupons === true}
          form={form}
          submitting={submitting}
          onSubmit={async (answers) => {
            if (submitting) return;
            setSubmitting(true);
            setSubmitError("");
            try {
              const couponField = form.fields.find(
                (field) => field.type === "coupon",
              );
              const enteredCoupon = couponField
                ? String(answers[couponField.id] || "")
                    .trim()
                    .toUpperCase()
                : "";
              if (checkoutOptions?.allowCoupons && enteredCoupon) {
                setCouponCode(enteredCoupon);
                setCouponAdded(false);
                setCouponQuote(null);
                setCouponValidationError("");
                setCouponValidationStatus("idle");
              }
              const params = new URLSearchParams(window.location.search);
              const utm = Object.fromEntries(
                ["utm_source", "utm_medium", "utm_campaign", "utm_content"]
                  .map((key) => [key, params.get(key)])
                  .filter((entry): entry is [string, string] => Boolean(entry[1])),
              );
              const shouldWaitForCheckoutOptions =
                checkoutOptionsQuery.isInitialLoading &&
                (form.settings.payment.enabled || eventCheckoutLikely);
              let resolvedCheckoutOptions = checkoutOptions;
              if (shouldWaitForCheckoutOptions) {
                const checkoutResult = await checkoutOptionsQuery.refetch();
                resolvedCheckoutOptions = checkoutResult.data || null;
              }
              const resolvedCheckoutEnabled = Boolean(
                form.settings.payment.enabled || resolvedCheckoutOptions?.enabled,
              );
              if (resolvedCheckoutEnabled && !resolvedCheckoutOptions?.enabled) {
                throw new Error(
                  "Checkout is unavailable right now. Please try again shortly.",
                );
              }
              const pendingPayment = Boolean(
                resolvedCheckoutEnabled && resolvedCheckoutOptions?.enabled,
              );
              const responseKey = getOrCreatePublicSubmissionKey(
                form,
                pendingSubmissionKey,
              );
              setPendingSubmissionKey(responseKey);
              const submission = await submitPublicForm(
                form,
                answers,
                {
                  referrer: document.referrer,
                  userAgent: navigator.userAgent,
                  utm,
                },
                {
                  accessToken,
                  clientSubmissionKey: responseKey,
                  pendingPayment,
                },
              );
              const submissionId = String(submission.id || "");
              if (!submissionId) {
                throw new Error("We could not prepare your response. Please try again.");
              }
              setSubmittedEventAccess(
                !pendingPayment &&
                  submission.eventAccess &&
                  typeof submission.eventAccess === "object"
                  ? submission.eventAccess as PublicEventAccess
                  : null,
              );
              await recordPublicSubmissionLocation(form.id, submissionId);
              setPendingSubmissionId(submissionId);
              const paymentAlreadyConfirmed =
                String(submission.submission_status || "") === "completed" &&
                ["completed", "not_required"].includes(
                  String(submission.payment_status || ""),
                );
              if (pendingPayment && paymentAlreadyConfirmed) {
                setSubmittedAnswers(answers);
                clearCompletedCheckout(form.id);
                setSubmitted(true);
                return;
              }
              if (pendingPayment) {
                setSubmittedAnswers(answers);
                window.scrollTo({ top: 0, behavior: "smooth" });
                setCheckoutRedirecting(true);
                window.setTimeout(() => {
                  setCheckoutActive(true);
                  setCheckoutRedirecting(false);
                }, CHECKOUT_REDIRECT_DELAY_MS);
                return;
              }
              setSubmittedAnswers(answers);
              clearCompletedCheckout(form.id);
              setSubmitted(true);
            } catch (error) {
              setSubmitError(
                error instanceof Error
                  ? error.message
                  : "Your response was not submitted.",
              );
            } finally {
              setSubmitting(false);
            }
          }}
        />
        {submitError && (
          <div
            className="mx-auto mt-4 max-w-[720px] border p-3 text-[12px]"
            style={{
              backgroundColor: "rgba(220,38,38,0.08)",
              borderColor: "rgba(220,38,38,0.28)",
              color: "#d73737",
            }}
          >
            {submitError}
          </div>
        )}
      </main>
    </div>
  );
}

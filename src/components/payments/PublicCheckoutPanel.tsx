import { useEffect, useState, type CSSProperties } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  ExternalLink,
  Home,
  Loader2,
  LockKeyhole,
  Mail,
  MapPin,
  ShieldCheck,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { parsePhoneNumber, type Country } from "react-phone-number-input";

import { PricingInput } from "@/components/shared/PricingInput";
import { Button } from "@/components/ui/button";
import {
  CountrySelect,
  countryCodeFromValue,
  countryNameForCode,
} from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select";
import type {
  PublicCheckoutCouponQuote,
  PublicCheckoutCustomerDetails,
  PublicCheckoutOptions,
  PublicCheckoutQuote,
} from "@/lib/checkout";
import { getCountryCities, getCountryStates } from "@/lib/geo-address";
import { formatCurrency } from "@/lib/regional-options";
import { cn } from "@/lib/utils";

const providerLogos: Record<string, string> = {
  stripe: "/logos/stripe.jpeg",
  paypal: "/logos/paypal.jpg",
  paystack: "/logos/paystack.jpeg",
  opay: "/logos/opay.png",
};

type PublicCheckoutPanelProps = {
  checkoutUnavailable: boolean;
  checkoutQuote: PublicCheckoutQuote | null;
  checkoutQuoteLoading: boolean;
  couponCode: string;
  couponQuote: PublicCheckoutCouponQuote | null;
  couponValidationError: string;
  couponValidationStatus: "idle" | "checking" | "valid" | "invalid";
  customer: PublicCheckoutCustomerDetails;
  customerComplete: boolean;
  loading: boolean;
  onCouponCodeChange: (code: string) => void;
  onCouponRemove: () => void;
  onCouponValidate: () => void;
  onCustomerChange: (customer: PublicCheckoutCustomerDetails) => void;
  onProviderChange: (provider: string) => void;
  onVariableAmountChange: (amount: number) => void;
  options: PublicCheckoutOptions | null;
  selectedProvider: string;
  submitButtonStyle?: CSSProperties;
  submitting: boolean;
  variableAmount: number;
};

const fieldClass =
  "bg-transparent text-[13px] shadow-none placeholder:opacity-55";

const checkoutInputStyle = {
  borderColor: "var(--form-border)",
  borderRadius: "var(--form-radius)",
  color: "inherit",
} as CSSProperties;

export function PublicCheckoutPanel({
  checkoutUnavailable,
  checkoutQuote,
  couponCode,
  couponQuote,
  couponValidationError,
  couponValidationStatus,
  customer,
  customerComplete,
  loading,
  onCouponCodeChange,
  onCouponRemove,
  onCouponValidate,
  onCustomerChange,
  onProviderChange,
  onVariableAmountChange,
  options,
  selectedProvider,
  submitButtonStyle,
  submitting,
  variableAmount,
}: PublicCheckoutPanelProps) {
  const [couponOpen, setCouponOpen] = useState(Boolean(couponCode));
  const [stateOptions, setStateOptions] = useState<SearchableSelectOption[]>(
    [],
  );
  const [cityOptions, setCityOptions] = useState<SearchableSelectOption[]>([]);
  const [addressOptionsLoading, setAddressOptionsLoading] = useState({
    cities: false,
    states: false,
  });
  useEffect(() => {
    if (!options?.allowCoupons) setCouponOpen(false);
  }, [options?.allowCoupons]);
  const accent = options?.workspace.accentColor || "var(--form-accent)";
  const workspaceName = options?.workspace.name || "Secure checkout";
  const amountReady =
    options?.mode !== "variable" || Number(variableAmount) > 0;
  const style = {
    "--checkout-accent": accent,
  } as CSSProperties;
  const patchCustomer = (patch: Partial<PublicCheckoutCustomerDetails>) =>
    onCustomerChange({ ...customer, ...patch });
  const selectedCountry =
    countryCodeFromValue(customer.country) as Country | undefined;
  const parsedPhoneCountry = (() => {
    try {
      return customer.phone ? parsePhoneNumber(customer.phone)?.country : undefined;
    } catch {
      return undefined;
    }
  })();
  const phoneCountry =
    selectedCountry || parsedPhoneCountry;
  useEffect(() => {
    if (!selectedCountry) {
      setStateOptions([]);
      setCityOptions([]);
      setAddressOptionsLoading((current) => ({
        ...current,
        states: false,
      }));
      return;
    }
    let cancelled = false;
    setAddressOptionsLoading((current) => ({ ...current, states: true }));
    void getCountryStates(selectedCountry)
      .then((states) => {
        if (!cancelled) setStateOptions(states);
      })
      .catch(() => {
        if (!cancelled) setStateOptions([]);
      })
      .finally(() => {
        if (!cancelled) {
          setAddressOptionsLoading((current) => ({
            ...current,
            states: false,
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCountry]);
  const selectedStateOption = stateOptions.find(
    (state) =>
      state.value.toLowerCase() === customer.region.trim().toLowerCase() ||
      state.label.toLowerCase() === customer.region.trim().toLowerCase(),
  );
  const selectedStateCode = selectedStateOption?.value || "";
  useEffect(() => {
    if (!selectedCountry || (!selectedStateCode && stateOptions.length > 0)) {
      setCityOptions([]);
      setAddressOptionsLoading((current) => ({
        ...current,
        cities: false,
      }));
      return;
    }
    let cancelled = false;
    setAddressOptionsLoading((current) => ({ ...current, cities: true }));
    void getCountryCities(selectedCountry, selectedStateCode)
      .then((cities) => {
        if (!cancelled) setCityOptions(cities);
      })
      .catch(() => {
        if (!cancelled) setCityOptions([]);
      })
      .finally(() => {
        if (!cancelled) {
          setAddressOptionsLoading((current) => ({
            ...current,
            cities: false,
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCountry, selectedStateCode, stateOptions.length]);
  const selectedCityValue =
    cityOptions.find(
      (city) =>
        city.value.toLowerCase() === customer.city.trim().toLowerCase(),
    )?.value || "";
  const selectedProviderName = selectedProvider
    ? options?.providers.find((provider) => provider.id === selectedProvider)
        ?.name || ""
    : "";
  const quoteCurrency =
    couponQuote?.currency || checkoutQuote?.currency || options?.currency || "USD";
  const subtotal =
    couponQuote?.subtotal ??
    checkoutQuote?.subtotal ??
    (options?.mode === "variable" ? variableAmount : options?.amount) ??
    0;
  const discount = couponQuote?.discount ?? 0;
  const total = couponQuote?.total ?? checkoutQuote?.total ?? subtotal;
  const amountKnown =
    options?.mode === "fixed" || Boolean(couponQuote || checkoutQuote);
  const couponLocked = couponValidationStatus === "valid" && Boolean(couponQuote);
  const couponCoversTotal = couponLocked && total <= 0;
  const requiresProvider = !couponCoversTotal;
  const hasPaymentMethod =
    couponCoversTotal ||
    Boolean(options?.providers.length && selectedProvider);
  const ready = Boolean(amountReady && customerComplete && hasPaymentMethod);
  const couponCanValidate = Boolean(
    couponCode.trim() &&
      !couponLocked &&
      couponValidationStatus !== "checking",
  );
  const checkoutContentAvailable = Boolean(
    options && (options.providers.length > 0 || options.allowCoupons),
  );
  const methodLabel = couponCoversTotal
    ? "Coupon"
    : selectedProviderName
      ? couponQuote && discount > 0
        ? `${selectedProviderName} + coupon`
        : selectedProviderName
      : "Required";

  return (
    <section
      className="mt-7 overflow-hidden border shadow-[0_24px_70px_rgba(15,23,42,0.10)]"
      style={{
        ...style,
        backgroundColor: "var(--form-surface)",
        borderColor: "var(--form-border)",
        borderRadius: "var(--form-radius)",
      }}
      aria-label="Secure checkout"
    >
      <div
        className="flex flex-col gap-4 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        style={{ borderColor: "var(--form-border)" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          {options?.workspace.logoUrl ? (
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden border bg-white p-1.5"
              style={{
                borderColor: "var(--form-border)",
                borderRadius: "var(--form-radius)",
              }}
            >
              <img
                src={options.workspace.logoUrl}
                alt=""
                className="h-full w-full object-contain"
              />
            </span>
          ) : (
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center text-white"
              style={{
                backgroundColor: accent,
                borderRadius: "var(--form-radius)",
              }}
            >
              <CreditCard className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">
              {workspaceName}
            </p>
            <p
              className="mt-0.5 text-[11px]"
              style={{ color: "var(--form-muted)" }}
            >
              Secure hosted payment
            </p>
          </div>
        </div>
        <span
          className="inline-flex w-fit items-center gap-1.5 text-[11px] font-medium"
          style={{ color: "var(--form-muted)" }}
        >
          <ShieldCheck
            className="h-4 w-4"
            style={{ color: "var(--checkout-accent)" }}
          />
          Protected checkout
        </span>
      </div>

      {loading ? (
        <div
          className="flex min-h-40 items-center justify-center gap-2 px-5 text-[12px]"
          style={{ color: "var(--form-muted)" }}
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing checkout
        </div>
      ) : checkoutContentAvailable ? (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="space-y-7 p-4 sm:p-6 lg:p-7">
            {options.allowCoupons && (
              <section
                className="overflow-hidden border bg-[color-mix(in_srgb,var(--checkout-accent)_4%,transparent)]"
                style={{
                  borderColor: "var(--form-border)",
                  borderRadius: "var(--form-radius)",
                }}
              >
                <button
                  type="button"
                  onClick={() => setCouponOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-[color-mix(in_srgb,var(--checkout-accent)_6%,transparent)]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Tag
                      className="h-4 w-4 shrink-0"
                      style={{ color: "var(--checkout-accent)" }}
                    />
                    <span>
                      <span className="block text-[13px] font-semibold">
                        Do you have a coupon?
                      </span>
                      <span
                        className="mt-0.5 block text-[11px]"
                        style={{ color: "var(--form-muted)" }}
                      >
                        {couponValidationStatus === "valid" && couponQuote
                          ? `${couponQuote.coupon.code} applied`
                          : couponValidationStatus === "checking"
                            ? "Checking code..."
                            : "Optional. Enter a code and validate it before payment"}
                      </span>
                    </span>
                  </span>
                  {couponOpen ? (
                    <ChevronUp className="h-4 w-4 shrink-0 opacity-60" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                  )}
                </button>
                {couponOpen && (
                  <div
                    className="border-t bg-[color-mix(in_srgb,var(--form-surface)_92%,transparent)] px-4 pb-4 pt-3"
                    style={{ borderColor: "var(--form-border)" }}
                  >
                    <Label htmlFor="public-payment-coupon">Coupon code</Label>
                    <div className="mt-2 flex flex-col gap-2 min-[420px]:flex-row">
                      <div className="relative min-w-0 flex-1">
                        <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
                        <Input
                          id="public-payment-coupon"
                          value={couponCode}
                          onChange={(event) => {
                            onCouponCodeChange(
                              event.target.value
                                .toUpperCase()
                                .replace(/[^A-Z0-9_-]/g, ""),
                            );
                          }}
                          disabled={
                            couponLocked ||
                            couponValidationStatus === "checking"
                          }
                          className={cn(
                            fieldClass,
                            "font-mono pl-9 uppercase disabled:cursor-not-allowed disabled:opacity-100",
                            couponLocked &&
                              "bg-[color-mix(in_srgb,var(--form-muted)_12%,transparent)] text-emerald-800",
                          )}
                          style={checkoutInputStyle}
                          placeholder="Enter coupon code"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                      {couponLocked ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={onCouponRemove}
                          className="min-[420px]:shrink-0 bg-transparent text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800"
                          style={{
                            borderColor: "rgba(16,185,129,0.35)",
                          }}
                        >
                          <X className="h-4 w-4" />
                          Remove
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          onClick={onCouponValidate}
                          disabled={!couponCanValidate}
                          className="min-[420px]:shrink-0 gap-2 shadow-sm transition hover:opacity-95 disabled:opacity-55"
                          style={submitButtonStyle}
                        >
                          {couponValidationStatus === "checking" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          Validate coupon
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setCouponOpen(false)}
                        className="min-[420px]:shrink-0 hover:bg-[color-mix(in_srgb,var(--checkout-accent)_8%,transparent)] hover:text-inherit"
                        aria-label="Close coupon field"
                      >
                        <X className="h-4 w-4" />
                        Close
                      </Button>
                    </div>
                    {couponCode.trim() && (
                      <div
                        className={cn(
                          "mt-3 flex items-start gap-2 rounded-sm border px-3 py-2 text-[11px] leading-5",
                          couponValidationStatus === "valid"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                            : couponValidationStatus === "invalid"
                              ? "border-red-500/30 bg-red-500/10 text-red-700"
                              : "text-[color:var(--form-muted)]",
                        )}
                      >
                        {couponValidationStatus === "checking" ? (
                          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                        ) : couponValidationStatus === "valid" ? (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>
                          {couponValidationStatus === "valid" && couponQuote
                            ? `${couponQuote.coupon.code} applied. ${formatCurrency(
                                couponQuote.discount,
                                quoteCurrency,
                              )} discount has been applied.`
                            : couponValidationStatus === "checking"
                              ? "Validating coupon..."
                              : couponValidationError ||
                                "This coupon is not valid for this checkout."}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            <section>
              <div className="flex items-center gap-2">
                <UserRound
                  className="h-4 w-4"
                  style={{ color: "var(--checkout-accent)" }}
                />
                <h2 className="text-[13px] font-semibold">Billing contact</h2>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="checkout-first-name">First name</Label>
                  <Input
                    id="checkout-first-name"
                    value={customer.firstName}
                    onChange={(event) =>
                      patchCustomer({ firstName: event.target.value })
                    }
                    autoComplete="given-name"
                    className={fieldClass}
                    style={checkoutInputStyle}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="checkout-last-name">Last name</Label>
                  <Input
                    id="checkout-last-name"
                    value={customer.lastName}
                    onChange={(event) =>
                      patchCustomer({ lastName: event.target.value })
                    }
                    autoComplete="family-name"
                    className={fieldClass}
                    style={checkoutInputStyle}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="checkout-email">Email receipt</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-55" />
                    <Input
                      id="checkout-email"
                      type="email"
                      value={customer.email}
                      onChange={(event) =>
                        patchCustomer({ email: event.target.value })
                      }
                      autoComplete="email"
                      className={cn(fieldClass, "pl-9")}
                      style={checkoutInputStyle}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="checkout-phone">Phone</Label>
                  <PhoneInput
                    id="checkout-phone"
                    value={customer.phone}
                    onChange={(phone) =>
                      patchCustomer({ phone: phone || "" })
                    }
                    defaultCountry={phoneCountry || "US"}
                    autoComplete="tel"
                    className="min-w-0"
                    placeholder="Optional"
                  />
                </div>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2">
                <MapPin
                  className="h-4 w-4"
                  style={{ color: "var(--checkout-accent)" }}
                />
                <h2 className="text-[13px] font-semibold">Billing address</h2>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="checkout-country">Country</Label>
                  <CountrySelect
                    id="checkout-country"
                    value={selectedCountry || ""}
                    onChange={(country) =>
                      patchCustomer({
                        city: "",
                        country: countryNameForCode(country as Country),
                        region: "",
                      })
                    }
                    className="bg-transparent text-[13px] shadow-none"
                    placeholder="Select country"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="checkout-region">State / region</Label>
                  {selectedCountry &&
                  !addressOptionsLoading.states &&
                  stateOptions.length === 0 ? (
                    <Input
                      id="checkout-region"
                      value={customer.region}
                      onChange={(event) =>
                        patchCustomer({ region: event.target.value })
                      }
                      autoComplete="address-level1"
                      className={fieldClass}
                      style={checkoutInputStyle}
                      placeholder="State / region"
                      required
                    />
                  ) : (
                    <SearchableSelect
                      id="checkout-region"
                      value={selectedStateCode}
                      onChange={(stateCode) => {
                        const state = stateOptions.find(
                          (option) => option.value === stateCode,
                        );
                        patchCustomer({
                          city: "",
                          region: state?.label || "",
                        });
                      }}
                      options={stateOptions}
                      disabled={!selectedCountry || addressOptionsLoading.states}
                      className="border-[var(--form-border)] bg-transparent text-[13px] shadow-none hover:bg-[color-mix(in_srgb,var(--checkout-accent)_6%,transparent)] hover:text-inherit"
                      placeholder={
                        addressOptionsLoading.states
                          ? "Loading states..."
                          : selectedCountry
                          ? "Select state / region"
                          : "Select country first"
                      }
                      searchPlaceholder="Search states..."
                      emptyText="No states found."
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="checkout-city">City</Label>
                  {selectedCountry &&
                  (selectedStateCode || stateOptions.length === 0) &&
                  !addressOptionsLoading.cities &&
                  cityOptions.length === 0 ? (
                    <Input
                      id="checkout-city"
                      value={customer.city}
                      onChange={(event) =>
                        patchCustomer({ city: event.target.value })
                      }
                      autoComplete="address-level2"
                      className={fieldClass}
                      style={checkoutInputStyle}
                      placeholder="City"
                      required
                    />
                  ) : (
                    <SearchableSelect
                      id="checkout-city"
                      value={selectedCityValue}
                      onChange={(city) => patchCustomer({ city })}
                      options={cityOptions}
                      disabled={
                        !selectedCountry ||
                        addressOptionsLoading.cities ||
                        (!selectedStateCode && stateOptions.length > 0) ||
                        cityOptions.length === 0
                      }
                      className="border-[var(--form-border)] bg-transparent text-[13px] shadow-none hover:bg-[color-mix(in_srgb,var(--checkout-accent)_6%,transparent)] hover:text-inherit"
                      placeholder={
                        addressOptionsLoading.cities
                          ? "Loading cities..."
                          : selectedStateCode || stateOptions.length === 0
                            ? "Select city"
                            : "Select state first"
                      }
                      searchPlaceholder="Search cities..."
                      emptyText="No cities found."
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="checkout-postal-code">Postal code</Label>
                  <Input
                    id="checkout-postal-code"
                    value={customer.postalCode}
                    onChange={(event) =>
                      patchCustomer({ postalCode: event.target.value })
                    }
                    autoComplete="postal-code"
                    className={fieldClass}
                    style={checkoutInputStyle}
                    required
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="checkout-address-line-1">Address</Label>
                  <div className="relative">
                    <Home className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-55" />
                    <Input
                      id="checkout-address-line-1"
                      value={customer.addressLine1}
                      onChange={(event) =>
                        patchCustomer({ addressLine1: event.target.value })
                      }
                      autoComplete="address-line1"
                      className={cn(fieldClass, "pl-9")}
                      style={checkoutInputStyle}
                      placeholder="Street address"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="checkout-address-line-2">
                    Apartment, suite, building
                  </Label>
                  <Input
                    id="checkout-address-line-2"
                    value={customer.addressLine2}
                    onChange={(event) =>
                      patchCustomer({ addressLine2: event.target.value })
                    }
                    autoComplete="address-line2"
                    className={fieldClass}
                    style={checkoutInputStyle}
                    placeholder="Optional"
                  />
                </div>
              </div>
            </section>
          </div>

          <aside
            className="border-t p-4 sm:p-6 lg:border-l lg:border-t-0 lg:p-7"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--checkout-accent) 10%, transparent), transparent 48%), color-mix(in srgb, var(--form-surface) 96%, var(--checkout-accent) 4%)",
              borderColor: "var(--form-border)",
            }}
          >
            <div className="space-y-5 lg:sticky lg:top-6">
              <section>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-semibold">Payment method</p>
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--checkout-accent) 10%, transparent)",
                      color: "var(--checkout-accent)",
                    }}
                  >
                    <LockKeyhole className="h-3 w-3" />
                    Encrypted
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
                  {couponCoversTotal ? (
                    <div
                      className="flex min-h-16 items-center gap-3 border bg-emerald-500/10 px-3 py-2 text-left shadow-sm"
                      style={{
                        borderColor: "rgba(16,185,129,0.35)",
                        borderRadius: "var(--form-radius)",
                        color: "#047857",
                      }}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                        <Tag className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold">
                          Coupon
                        </span>
                        <span className="mt-0.5 block truncate text-[10px]">
                          Covers the full checkout amount
                        </span>
                      </span>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  ) : options.providers.length ? (
                    options.providers.map((provider) => {
                    const selected = selectedProvider === provider.id;
                    return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => onProviderChange(provider.id)}
                    className={cn(
                          "flex min-h-16 items-center gap-3 border bg-[color-mix(in_srgb,var(--form-surface)_96%,transparent)] px-3 py-2 text-left shadow-sm transition hover:text-inherit",
                          selected
                            ? "border-[var(--checkout-accent)] ring-2 ring-[color-mix(in_srgb,var(--checkout-accent)_18%,transparent)]"
                            : "hover:-translate-y-0.5 hover:bg-[color-mix(in_srgb,var(--checkout-accent)_5%,transparent)]",
                        )}
                        style={{ borderRadius: "var(--form-radius)" }}
                        aria-pressed={selected}
                      >
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden border bg-white p-1.5"
                          style={{
                            borderColor: "var(--form-border)",
                            borderRadius: "var(--form-radius)",
                          }}
                        >
                          <img
                            src={providerLogos[provider.id]}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold">
                            {provider.name}
                          </span>
                          <span
                            className="mt-0.5 block truncate text-[10px]"
                            style={{ color: "var(--form-muted)" }}
                          >
                            {provider.accountName || "Secure payment page"}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                            selected && "border-transparent text-white",
                          )}
                          style={
                            selected
                              ? { backgroundColor: "var(--checkout-accent)" }
                              : { borderColor: "var(--form-border)" }
                          }
                        >
                          {selected && <Check className="h-3.5 w-3.5" />}
                        </span>
                      </button>
                    );
                  })
                  ) : (
                    <div
                      className="flex items-start gap-2 border px-3 py-3 text-[11px] leading-5"
                      style={{
                        backgroundColor: "rgba(220,38,38,0.08)",
                        borderColor: "rgba(220,38,38,0.28)",
                        borderRadius: "var(--form-radius)",
                        color: "#B91C1C",
                      }}
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      No payment provider is available. A coupon must cover the
                      full checkout amount to continue.
                    </div>
                  )}
                  {!couponCoversTotal && couponQuote && discount > 0 && (
                    <div className="flex items-start gap-2 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] leading-5 text-emerald-700">
                      <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {couponQuote.coupon.code} removes{" "}
                        {formatCurrency(discount, quoteCurrency)} from this
                        checkout and will be applied with the selected payment
                        method.
                      </span>
                    </div>
                  )}
                </div>
              </section>

              <section
                className="border p-4 shadow-sm"
                style={{
                  backgroundColor: "var(--form-surface)",
                  borderColor: "var(--form-border)",
                  borderRadius: "var(--form-radius)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[13px] font-semibold">Order summary</h2>
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--checkout-accent) 9%, transparent)",
                      color: "var(--checkout-accent)",
                    }}
                  >
                    {options.currency}
                  </span>
                </div>
                <div className="mt-5 space-y-4">
                  <div>
                    <p
                      className="text-[11px] font-medium"
                      style={{ color: "var(--form-muted)" }}
                    >
                      Amount due
                    </p>
                    {options.mode === "variable" ? (
                      <div className="mt-3 space-y-3">
                        <PricingInput
                          id="public-payment-amount"
                          label="Payment amount"
                          currency={options.currency}
                          min={0.01}
                          value={variableAmount}
                          onValueChange={onVariableAmountChange}
                        />
                        <p className="text-[24px] font-semibold leading-none tabular-nums">
                          {formatCurrency(total, quoteCurrency)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-2 text-[30px] font-semibold leading-none tabular-nums">
                        {amountKnown
                          ? formatCurrency(total, quoteCurrency)
                          : "Calculated after submission"}
                      </p>
                    )}
                  </div>
                  {(couponQuote || checkoutQuote) && (
                    <div className="space-y-2 text-[12px]">
                      {checkoutQuote?.items && checkoutQuote.items.length > 1 && (
                        <div className="space-y-2 border-b pb-3" style={{ borderColor: "var(--form-border)" }}>
                          {checkoutQuote.items.map((item, index) => (
                            <div key={`${item.name}-${item.variantName}-${index}`} className="flex items-start justify-between gap-4">
                              <p className="min-w-0" style={{ color: "var(--form-muted)" }}>
                                {item.quantity} × {item.name}{item.variantName ? ` · ${item.variantName}` : ""}
                              </p>
                              <p className="shrink-0 font-medium tabular-nums">{formatCurrency(item.totalAmount, quoteCurrency)}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {checkoutQuote?.itemName && (
                        <div className="flex items-start justify-between gap-4">
                          <p style={{ color: "var(--form-muted)" }}>Item</p>
                          <p className="min-w-0 text-right font-medium">
                            {checkoutQuote.itemName}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-4">
                        <p style={{ color: "var(--form-muted)" }}>Subtotal</p>
                        <p className="font-medium tabular-nums">
                          {formatCurrency(subtotal, quoteCurrency)}
                        </p>
                      </div>
                      {(checkoutQuote?.taxAmount || 0) > 0 && (
                        <div className="flex items-center justify-between gap-4">
                          <p style={{ color: "var(--form-muted)" }}>Tax</p>
                          <p className="font-medium tabular-nums">{formatCurrency(checkoutQuote?.taxAmount || 0, quoteCurrency)}</p>
                        </div>
                      )}
                      {((checkoutQuote?.shippingAmount || 0) > 0 || checkoutQuote?.shippingLabel) && (
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p style={{ color: "var(--form-muted)" }}>
                              {checkoutQuote?.shippingLabel || "Shipping"}
                            </p>
                            {checkoutQuote?.shippingDeliveryEstimate && (
                              <p className="mt-0.5 text-[10px]" style={{ color: "var(--form-muted)" }}>
                                {checkoutQuote.shippingDeliveryEstimate}
                              </p>
                            )}
                          </div>
                          <p className="font-medium tabular-nums">
                            {(checkoutQuote?.shippingAmount || 0) > 0
                              ? formatCurrency(checkoutQuote?.shippingAmount || 0, quoteCurrency)
                              : "Free"}
                          </p>
                        </div>
                      )}
                      {discount > 0 && (
                        <div className="flex items-center justify-between gap-4 text-emerald-700">
                          <p>Discount</p>
                          <p className="font-semibold tabular-nums">
                            -{formatCurrency(discount, quoteCurrency)}
                          </p>
                        </div>
                      )}
                      <div
                        className="flex items-center justify-between gap-4 border-t pt-2"
                        style={{ borderColor: "var(--form-border)" }}
                      >
                        <p className="font-semibold">Total due</p>
                        <p className="font-semibold tabular-nums">
                          {formatCurrency(total, quoteCurrency)}
                        </p>
                      </div>
                    </div>
                  )}
                  <div
                    className="space-y-3 border-y py-4 text-[12px]"
                    style={{ borderColor: "var(--form-border)" }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <p style={{ color: "var(--form-muted)" }}>Contact</p>
                      <p className="min-w-0 break-words text-right font-medium">
                        {customer.email || "Required"}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <p style={{ color: "var(--form-muted)" }}>Method</p>
                      <p className="text-right font-medium">
                        {methodLabel}
                      </p>
                    </div>
                  </div>
                  <div
                    className="flex items-start gap-2 text-[10px] leading-5"
                    style={{ color: "var(--form-muted)" }}
                  >
                    <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {couponCoversTotal
                      ? "No card or bank details are needed because the coupon covers the full amount."
                      : "Card and bank details are entered only on the selected provider's secure payment page."}
                  </div>
                  {!ready && (
                    <div
                      className="flex items-start gap-2 border px-3 py-2 text-[11px] leading-5"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, var(--checkout-accent) 8%, transparent)",
                        borderColor: "var(--form-border)",
                        borderRadius: "var(--form-radius)",
                        color: "var(--form-muted)",
                      }}
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {requiresProvider
                        ? "Complete billing details and choose a payment method to continue."
                        : "Complete billing details to continue."}
                    </div>
                  )}
                </div>
              </section>

              <Button
                type="submit"
                disabled={
                  checkoutUnavailable ||
                  loading ||
                  submitting ||
                  couponValidationStatus === "checking"
                }
                aria-busy={submitting}
                className={cn(
                  "h-12 w-full justify-center gap-2 text-[14px] font-semibold shadow-[0_16px_30px_rgba(15,23,42,0.16)] transition hover:opacity-95 hover:shadow-[0_20px_38px_rgba(15,23,42,0.18)] disabled:opacity-60 disabled:hover:opacity-60",
                  submitting && "opacity-70",
                )}
                style={submitButtonStyle}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : couponCoversTotal ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                {submitting
                  ? couponCoversTotal
                    ? "Completing order"
                    : "Preparing payment"
                  : couponCoversTotal
                    ? "Complete with coupon"
                    : "Continue to secure payment"}
              </Button>
              <p
                className="text-center text-[10px] leading-5"
                style={{ color: "var(--form-muted)" }}
              >
                {couponCoversTotal
                  ? "Your order will be completed immediately after final validation."
                  : "You will be redirected to the selected provider's secure payment page."}
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="px-5 py-7">
          <p className="text-[13px] font-semibold">
            Payment is temporarily unavailable
          </p>
          <p
            className="mt-1 text-[11px] leading-5"
            style={{ color: "var(--form-muted)" }}
          >
            Please return shortly or contact the form owner.
          </p>
        </div>
      )}
    </section>
  );
}

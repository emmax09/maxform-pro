import type { PaymentProviderId } from "@/components/payments/payment-types";
import type {
  EventTicketDesignTemplate,
  TicketCanvasElement,
} from "@/components/events/event-types";

export type PublicPaymentOption = {
  id: PaymentProviderId;
  name: string;
  accountName: string;
};

export type PublicCheckoutOptions = {
  enabled: boolean;
  allowCoupons: boolean;
  mode: "fixed" | "variable" | "product" | "cart";
  amount: number;
  currency: string;
  providers: PublicPaymentOption[];
  workspace: {
    accentColor: string;
    logoUrl: string;
    name: string;
  };
};

export type PublicCheckoutCustomerDetails = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  country: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  postalCode: string;
  region: string;
};

export type PublicCheckoutCouponQuote = {
  valid: true;
  coupon: {
    code: string;
    id: string;
  };
  currency: string;
  discount: number;
  subtotal: number;
  total: number;
};

export type PublicCheckoutQuote = {
  currency: string;
  itemName: string;
  paymentRequired: boolean;
  subtotal: number;
  taxAmount: number;
  shippingAmount: number;
  shippingDeliveryEstimate?: string;
  shippingLabel?: string;
  items: Array<{
    name: string;
    variantName: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
  }>;
  total: number;
};

export type PublicIssuedEventTicket = {
  attendeeEmail: string;
  attendeeName: string;
  code: string;
  currency: string;
  design: {
    backLayout: TicketCanvasElement[];
    frontLayout: TicketCanvasElement[];
    templateId: string;
    theme: EventTicketDesignTemplate["theme"];
  } | null;
  endsAt: string;
  eventCode: string;
  eventDescription: string;
  eventTitle: string;
  location: string;
  number: string;
  onlineUrl: string;
  orderCode: string;
  price: number;
  seo: Record<string, unknown>;
  startsAt: string;
  terms: string;
  ticketType: string;
  timezone: string;
  venue: string;
};

export type PublicEventAccess = {
  date: string;
  endTime: string;
  eventTitle: string;
  joinUrl: string;
  meetingProvider: string;
  startTime: string;
  timezone: string;
};

export type PublicOrderStatus = {
  status: "pending" | "redirected" | "processing" | "confirmed" | "failed" | "expired";
  confirmation: {
    message: string;
    redirectDelay: number;
    redirectUrl: string;
    title: string;
    type: "message" | "redirect" | "message_redirect";
  };
  order: {
    number: string;
    amount: number;
    billingDetails: PublicCheckoutCustomerDetails;
    currency: string;
    customerEmail: string;
    customerName: string;
    discountAmount: number;
    paidAt: string;
    provider: PaymentProviderId | "coupon";
    providerReference: string;
    subtotal: number;
    taxAmount: number;
    shippingAmount: number;
    ticket: PublicIssuedEventTicket | null;
    tickets: PublicIssuedEventTicket[];
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      totalAmount: number;
    }>;
  };
  eventAccess: PublicEventAccess | null;
  form: {
    id: string;
    publicUrl: string;
  };
  retryUrl: string;
  workspace: {
    accentColor: string;
    logoUrl: string;
    name: string;
  };
};

/**
 * Removes only unfinished checkout state for one public form. It deliberately
 * leaves workspace authentication and every other form's browser data intact.
 */
export const clearPublicCheckoutDrafts = (formId: string) => {
  if (typeof window === "undefined" || !formId) return;
  const prefix = `maxform:checkout-draft:${formId}:`;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) window.localStorage.removeItem(key);
    }
  } catch {
    // Browser storage is optional for public checkout.
  }
};

const request = async <T>(url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  const value = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      value.error || "Checkout is temporarily unavailable. Please try again.",
    );
  }
  return value;
};

const couponDeviceId = () => {
  if (typeof window === "undefined") return "";
  const key = "maxform:coupon-device-id";
  try {
    const existing = window.localStorage.getItem(key);
    if (/^[A-Za-z0-9_-]{16,160}$/.test(existing || "")) return existing;
    const created = crypto.randomUUID().replace(/-/g, "");
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return "";
  }
};

/**
 * Produces an anonymous, deterministic device signal for coupon limits. It
 * deliberately excludes account data, IP addresses, and the user agent so
 * the same physical device is more likely to match across browsers without
 * persisting any identifying browser fingerprint on the server.
 */
const couponDeviceFingerprint = async () => {
  if (typeof window === "undefined" || !window.crypto?.subtle) return "";
  try {
    const signal = JSON.stringify({
      colorDepth: window.screen?.colorDepth || 0,
      cores: navigator.hardwareConcurrency || 0,
      language: navigator.language || "",
      languages: navigator.languages?.join(",") || "",
      maxTouchPoints: navigator.maxTouchPoints || 0,
      platform: navigator.platform || "",
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}:${window.screen?.availWidth || 0}x${window.screen?.availHeight || 0}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      version: 1,
    });
    const digest = await window.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(signal),
    );
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
};

export const getPublicCheckoutOptions = (formId: string) =>
  request<PublicCheckoutOptions>(
    `/api/payments/checkout?action=options&form=${encodeURIComponent(formId)}&v=${Date.now()}`,
  );

export const createPublicCheckout = async (input: {
  amount?: number;
  couponCode?: string;
  customer: PublicCheckoutCustomerDetails;
  formId: string;
  idempotencyKey: string;
  provider?: PaymentProviderId;
  submissionId: string;
}) => {
  const [deviceFingerprint, deviceId] = await Promise.all([
    couponDeviceFingerprint(),
    Promise.resolve(couponDeviceId()),
  ]);
  return request<{
    attemptKey?: string;
    checkoutUrl?: string;
    free?: boolean;
    status?: string;
  }>("/api/payments/checkout?action=create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, deviceFingerprint, deviceId }),
  });
};

export const validatePublicCheckoutCoupon = (input: {
  amount?: number;
  couponCode: string;
  formId: string;
  submissionId: string;
  customer?: PublicCheckoutCustomerDetails;
}) =>
  request<PublicCheckoutCouponQuote>("/api/payments/checkout?action=coupon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const getPublicCheckoutQuote = (input: {
  amount?: number;
  formId: string;
  submissionId: string;
  customer?: PublicCheckoutCustomerDetails;
}) =>
  request<PublicCheckoutQuote>("/api/payments/checkout?action=quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const getPublicOrderStatus = (attemptKey: string) =>
  request<PublicOrderStatus>(
    `/api/payments/checkout?action=status&key=${encodeURIComponent(attemptKey)}`,
  );

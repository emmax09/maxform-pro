import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  Download,
  Fingerprint,
  Loader2,
  Lock,
  Mail,
  MapPin,
  ReceiptText,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { jsPDF } from "jspdf";

import { downloadOrderReceipt } from "@/lib/order-receipt";
import html2canvas from "html2canvas";
import { Link, useParams } from "react-router-dom";

import type { TicketCanvasElement } from "@/components/events/event-types";
import { TicketSurface } from "@/components/events/ticket-surface";
import { Button } from "@/components/ui/button";
import {
  clearPublicCheckoutDrafts,
  getPublicOrderStatus,
  type PublicCheckoutCustomerDetails,
  type PublicIssuedEventTicket,
  type PublicOrderStatus,
} from "@/lib/checkout";
import { publicThemeVariables, readableColorOn } from "@/lib/public-theme";
import { formatCurrency } from "@/lib/regional-options";
import type { TicketElementResolver } from "@/lib/ticket-theme";
import { cn } from "@/lib/utils";

type VerificationState =
  | "checking"
  | "confirmed"
  | "processing"
  | "failed";

const orderReviewRedirectSeconds = 90;
const minVerifyDisplayMs = 33_000;

const fallbackWorkspace = {
  accentColor: "#F93D0A",
  logoUrl: "",
  name: "Secure checkout",
};

// Used only while the workspace's real brand color is still unknown.
const fallbackAccent = "#F93D0A";

type UrlWorkspace = {
  accentColor: string;
  logoUrl: string;
  name: string;
};

const validHexColor = /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^#[0-9a-f]{8}$/i;

// The payment provider redirects back with exactly the query string we gave
// it on the return URL, so this branding is known synchronously on first
// paint - no lookup, no cache, no race with the status poll.
const readUrlWorkspace = (): UrlWorkspace | null => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const name = params.get("wn")?.trim() || "";
  if (!name) return null;
  const rawColor = params.get("wc")?.trim() || "";
  return {
    accentColor: validHexColor.test(rawColor)
      ? rawColor
      : fallbackWorkspace.accentColor,
    logoUrl: params.get("wl")?.trim() || "",
    name,
  };
};

const providerName = (provider: string) =>
  provider === "coupon"
    ? "Coupon"
    : provider === "opay"
    ? "OPay"
    : provider.slice(0, 1).toUpperCase() + provider.slice(1);

const calendarDate = (value: string) =>
  new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const calendarText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,");

const addressLines = (customer: PublicCheckoutCustomerDetails) =>
  [
    customer.addressLine1,
    customer.addressLine2,
    [customer.city, customer.region, customer.postalCode]
      .filter(Boolean)
      .join(", "),
    customer.country,
  ].filter(Boolean);

const displayName = (customer: PublicCheckoutCustomerDetails, fallback = "") =>
  [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
  fallback ||
  "Customer";

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });

const downloadTicket = async (
  ticket: PublicIssuedEventTicket,
  artwork: HTMLDivElement,
) => {
  const surfaces = Array.from(
    artwork.querySelectorAll<HTMLElement>("[data-ticket-template-canvas]"),
  );
  if (!surfaces.length) return;
  const rendered = await Promise.all(
    surfaces.map((surface) =>
      html2canvas(surface, {
        backgroundColor: null,
        logging: false,
        scale: Math.max(2, Math.min(3, window.devicePixelRatio || 1)),
        useCORS: true,
      }),
    ),
  );
  const gap = 32;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(...rendered.map((item) => item.width));
  canvas.height =
    rendered.reduce((height, item) => height + item.height, 0) +
    gap * Math.max(0, rendered.length - 1);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  rendered.forEach((item) => {
    context.drawImage(item, Math.round((canvas.width - item.width) / 2), y);
    y += item.height + gap;
  });
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${ticket.number || "event-ticket"}.png`;
  link.click();
};

const downloadCalendar = (
  ticket: PublicIssuedEventTicket,
) => {
  if (!ticket.startsAt) return;
  const start = calendarDate(ticket.startsAt);
  const end = calendarDate(ticket.endsAt || ticket.startsAt);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MaxForm//Event Ticket//EN",
    "BEGIN:VEVENT",
    `UID:${calendarText(ticket.number)}@maxform`,
    `DTSTAMP:${calendarDate(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${calendarText(ticket.eventTitle)}`,
    `LOCATION:${calendarText(ticket.location || "")}`,
    `DESCRIPTION:Ticket ${calendarText(ticket.number)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([ics], { type: "text/calendar;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${ticket.eventTitle || "event"}.ics`;
  link.click();
  URL.revokeObjectURL(url);
};

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.replace("#", "").trim();
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : normalized;
  const parsed = Number.parseInt(value, 16);
  if (!/^[\da-f]{6}$/i.test(value) || Number.isNaN(parsed)) {
    return [249, 61, 10];
  }
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
};

const sanitizeFilename = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60) || "Customer";


const fallbackTicketTheme = {
  accent: "#F93D0A",
  background: "#FFFFFF",
  edge: "solid" as const,
  motif: "none",
  muted: "#64748B",
  text: "#0F172A",
};

const fallbackTicketFront: TicketCanvasElement[] = [
  { id: "event", type: "event_name", label: "Event", x: 6, y: 12, width: 62, size: "large" },
  { id: "details", type: "event_details", label: "Event details", x: 6, y: 46, width: 62, size: "small" },
  { id: "type", type: "ticket_type", label: "Ticket type", x: 6, y: 72, width: 38, size: "medium" },
  { id: "number", type: "ticket_number", label: "Ticket number", x: 6, y: 88, width: 56, size: "small" },
  { id: "qr", type: "qr", label: "Secure QR", x: 78, y: 20, width: 16 },
];

const fallbackTicketBack: TicketCanvasElement[] = [
  { id: "attendee", type: "attendee_name", label: "Attendee", x: 7, y: 14, width: 55, size: "medium" },
  { id: "email", type: "attendee_email", label: "Email", x: 7, y: 38, width: 55, size: "small" },
  { id: "terms", type: "terms", label: "Present this ticket at entry.", x: 7, y: 68, width: 58, size: "small" },
  { id: "qr-back", type: "qr", label: "Secure QR", x: 79, y: 50, width: 13 },
];

const ticketDatePart = (
  value: string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
) => {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      timeZone: timezone || undefined,
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
  }
};

const issuedTicketResolver = (
  ticket: PublicIssuedEventTicket,
  workspaceName: string,
): TicketElementResolver => {
  const eventDate = ticketDatePart(ticket.startsAt, ticket.timezone, {
    dateStyle: "full",
  });
  const eventTime = ticketDatePart(ticket.startsAt, ticket.timezone, {
    timeStyle: "short",
  });
  const seoDescription =
    ticket.seo && typeof ticket.seo.description === "string"
      ? ticket.seo.description
      : "";
  return (element) => {
    const captioned = (text: string) => ({ caption: element.label, text });
    switch (element.type) {
      case "event_name":
        return { text: ticket.eventTitle };
      case "event_tagline":
        return { text: seoDescription || ticket.eventDescription };
      case "event_details":
        return captioned(
          [eventDate, eventTime, ticket.venue || ticket.location]
            .filter(Boolean)
            .join(" · "),
        );
      case "event_date":
        return captioned(eventDate);
      case "event_time":
        return captioned(eventTime);
      case "venue":
        return captioned(ticket.venue || ticket.location);
      case "address":
        return captioned(ticket.location);
      case "organizer":
        return captioned(workspaceName);
      case "attendee_name":
        return captioned(ticket.attendeeName);
      case "attendee_email":
        return captioned(ticket.attendeeEmail);
      case "ticket_type":
        return captioned(ticket.ticketType);
      case "ticket_price":
        return captioned(
          ticket.price ? formatCurrency(ticket.price, ticket.currency) : "Free",
        );
      case "ticket_number":
        return captioned(ticket.number);
      case "order_code":
        return captioned(ticket.orderCode);
      case "event_code":
        return captioned(ticket.eventCode);
      case "terms":
        return { text: element.value || ticket.terms || element.label };
      default:
        return { text: element.value || element.label };
    }
  };
};

function ConfirmedTicket({
  accent,
  index,
  ticket,
  total,
  workspaceName,
}: {
  accent: string;
  index: number;
  ticket: PublicIssuedEventTicket;
  total: number;
  workspaceName: string;
}) {
  const artworkRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const resolve = useMemo(
    () => issuedTicketResolver(ticket, workspaceName),
    [ticket, workspaceName],
  );
  const theme = useMemo(
    () => ({ ...fallbackTicketTheme, ...(ticket.design?.theme || {}) }),
    [ticket.design?.theme],
  );
  const frontLayout = ticket.design
    ? ticket.design.frontLayout
    : fallbackTicketFront;
  const backLayout = ticket.design
    ? ticket.design.backLayout
    : fallbackTicketBack;

  const handleDownload = async () => {
    if (!artworkRef.current || downloading) return;
    setDownloading(true);
    setDownloadFailed(false);
    try {
      await downloadTicket(ticket, artworkRef.current);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section
      className="mt-6 overflow-hidden border shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
      style={{ borderColor: "var(--border)", borderRadius: "var(--radius)" }}
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <p
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--muted-foreground)" }}
          >
            {total > 1 ? `Ticket ${index + 1} of ${total}` : "Event ticket"}
          </p>
          <h2 className="mt-2 text-[19px] font-semibold leading-tight">
            {ticket.eventTitle}
          </h2>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            {ticket.ticketType || "Admission"} · {ticket.number}
          </p>
          {ticket.location && (
            <p
              className="mt-2 flex items-center gap-1.5 text-[12px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {ticket.location}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!ticket.code || downloading}
            loading={downloading}
            loadingLabel="Preparing ticket download"
            onClick={() => void handleDownload()}
          >
            <Download className="h-3.5 w-3.5" />
            Download ticket
          </Button>
          {ticket.startsAt && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => downloadCalendar(ticket)}
              style={{ color: accent }}
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Add to calendar
            </Button>
          )}
        </div>
      </div>
      {downloadFailed && (
        <p className="px-5 pb-4 text-[12px] text-red-600 sm:px-6">
          The ticket image could not be prepared. Please try again.
        </p>
      )}
      <div
        ref={artworkRef}
        className="space-y-4 border-t p-4 sm:p-6"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "hsl(var(--surface-muted))",
        }}
      >
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Front
          </p>
          <TicketSurface
            elements={frontLayout}
            flat
            qrValue={ticket.code || ticket.number}
            resolve={resolve}
            side="front"
            theme={theme}
            ticketNumber={ticket.number}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Back
          </p>
          <TicketSurface
            elements={backLayout}
            flat
            qrValue={ticket.code || ticket.number}
            resolve={resolve}
            side="back"
            theme={theme}
            ticketNumber={ticket.number}
          />
        </div>
      </div>
    </section>
  );
}

function StatusScreen({
  accent,
  actions,
  description,
  icon: Icon,
  iconClassName,
  title,
}: {
  accent: string;
  actions?: ReactNode;
  description: string;
  icon: typeof CheckCircle2;
  iconClassName?: string;
  title: string;
}) {
  return (
    <div className="mx-auto max-w-[480px]">
      <section
        className="border p-8 text-center shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:p-12"
        style={{
          borderColor: "var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <span
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: `${accent}14` }}
        >
          <Icon
            className={iconClassName || "h-6 w-6"}
            style={{ color: accent }}
          />
        </span>
        <h1 className="mt-5 text-[22px] font-semibold leading-tight">
          {title}
        </h1>
        <p
          className="mx-auto mt-2 max-w-[380px] text-[13px] leading-6"
          style={{ color: "var(--muted-foreground)" }}
        >
          {description}
        </p>
        {actions && <div className="mt-6">{actions}</div>}
      </section>
    </div>
  );
}

function VerificationProgress({
  accent,
  brandKnown,
  provider,
  workspaceLogoUrl,
  workspaceName,
}: {
  accent: string;
  brandKnown: boolean;
  provider: string;
  workspaceLogoUrl: string;
  workspaceName: string;
}) {
  const steps = useMemo(
    () => [
      { icon: CreditCard, label: "Payment received" },
      { icon: Fingerprint, label: "Verifying transaction signature" },
      {
        icon: ShieldCheck,
        label: provider
          ? `Checking with ${providerName(provider)}`
          : "Checking with your payment provider",
      },
      { icon: ReceiptText, label: "Validating order & billing details" },
      { icon: Lock, label: "Running security checks" },
      { icon: CheckCircle2, label: "Finalizing your confirmation" },
    ],
    [provider],
  );
  const [activeStep, setActiveStep] = useState(0);
  const [barFilled, setBarFilled] = useState(false);
  const stepMs = minVerifyDisplayMs / steps.length;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setBarFilled(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveStep((current) => Math.min(current + 1, steps.length - 1));
    }, stepMs);
    return () => window.clearInterval(interval);
  }, [stepMs, steps.length]);

  return (
    <div className="public-theme flex min-h-screen items-center justify-center px-5 py-12">
      <section
        className="w-full max-w-[420px] overflow-hidden border bg-white shadow-[0_20px_50px_rgba(15,23,42,0.10)]"
        style={{
          borderColor: "var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <div
          className="h-[3px] w-full"
          style={{ backgroundColor: "var(--border)" }}
        >
          <div
            className="h-full"
            style={{
              backgroundColor: accent,
              width: barFilled ? "100%" : "0%",
              transition: `width ${minVerifyDisplayMs}ms linear`,
            }}
          />
        </div>

        <div className="p-8 text-center sm:p-9">
          {brandKnown ? (
            workspaceLogoUrl ? (
              <span
                className="mx-auto flex h-12 w-12 items-center justify-center overflow-hidden border bg-white p-2"
                style={{ borderColor: "var(--border)", borderRadius: "10px" }}
              >
                <img
                  src={workspaceLogoUrl}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </span>
            ) : (
              <span
                className="mx-auto flex h-12 w-12 items-center justify-center text-white"
                style={{ backgroundColor: accent, borderRadius: "10px" }}
              >
                <ShieldCheck className="h-5 w-5" />
              </span>
            )
          ) : (
            <span
              className="mx-auto flex h-12 w-12 animate-pulse items-center justify-center"
              style={{
                backgroundColor: "var(--muted)",
                borderRadius: "10px",
              }}
            />
          )}
          {brandKnown ? (
            <p
              className="mt-3 text-[12px] font-medium"
              style={{ color: "var(--muted-foreground)" }}
            >
              {workspaceName}
            </p>
          ) : (
            <span
              className="mx-auto mt-3 block h-3 w-24 animate-pulse rounded-full"
              style={{ backgroundColor: "var(--muted)" }}
            />
          )}
          <h1 className="mt-2 text-[20px] font-semibold leading-tight">
            Verifying your payment
          </h1>
          <p
            className="mx-auto mt-2 max-w-[300px] text-[12.5px] leading-6"
            style={{ color: "var(--muted-foreground)" }}
          >
            Please don&apos;t close this page. We&apos;re running a secure
            check on your payment before confirming your order.
          </p>

          <div className="mt-7 text-left">
            {steps.map((step, index) => {
              const status =
                index < activeStep
                  ? "done"
                  : index === activeStep
                    ? "active"
                    : "pending";
              const Icon = step.icon;
              const isLast = index === steps.length - 1;
              return (
                <div key={step.label} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-500",
                        status === "active" && "scale-110",
                      )}
                      style={
                        status === "done"
                          ? {
                              backgroundColor: accent,
                              borderColor: accent,
                              color: "#FFFFFF",
                            }
                          : status === "active"
                            ? {
                                borderColor: accent,
                                color: accent,
                                backgroundColor: `${accent}14`,
                                boxShadow: `0 0 0 4px ${accent}1F`,
                              }
                            : {
                                borderColor: "var(--border)",
                                color: "var(--muted-foreground)",
                              }
                      }
                    >
                      {status === "done" ? (
                        <Check className="h-4 w-4" />
                      ) : status === "active" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </span>
                    {!isLast && (
                      <span
                        className="mt-1 w-[2px] flex-1 rounded-full transition-colors duration-500"
                        style={{
                          minHeight: "22px",
                          backgroundColor:
                            index < activeStep ? accent : "var(--border)",
                        }}
                      />
                    )}
                  </div>
                  <div className={cn("pb-5 pt-2", isLast && "pb-0")}>
                    <p
                      className="text-[13px] font-medium leading-tight transition-colors duration-500"
                      style={{
                        color:
                          status === "pending"
                            ? "var(--muted-foreground)"
                            : "#171719",
                      }}
                    >
                      {step.label}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

const successRevealMs = 2800;

function SuccessAnimation({
  accent,
  amount,
  currency,
  workspaceLogoUrl,
  workspaceName,
}: {
  accent: string;
  amount: number;
  currency: string;
  workspaceLogoUrl: string;
  workspaceName: string;
}) {
  return (
    <div className="public-theme flex min-h-screen items-center justify-center px-5 py-12">
      <section
        className="w-full max-w-[400px] border bg-white p-9 text-center shadow-[0_20px_50px_rgba(15,23,42,0.10)]"
        style={{
          borderColor: "var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
          <span
            className="animate-success-ring absolute inset-0 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <span
            className="animate-success-pop relative flex h-20 w-20 items-center justify-center rounded-full"
            style={{ backgroundColor: accent }}
          >
            <Check className="h-9 w-9 text-white" strokeWidth={3} />
          </span>
        </div>

        <h1 className="animate-success-fade-up mt-6 text-[22px] font-semibold leading-tight">
          Payment confirmed
        </h1>
        <p
          className="animate-success-fade-up mx-auto mt-2 max-w-[280px] text-[13px] leading-6"
          style={{ color: "var(--muted-foreground)" }}
        >
          Your payment of{" "}
          <span className="font-semibold" style={{ color: "#171719" }}>
            {formatCurrency(amount, currency)}
          </span>{" "}
          to {workspaceName} was successful.
        </p>

        <div className="animate-success-fade-up mt-6 flex items-center justify-center gap-2">
          {workspaceLogoUrl ? (
            <span
              className="flex h-6 w-6 items-center justify-center overflow-hidden border bg-white p-1"
              style={{ borderColor: "var(--border)", borderRadius: "6px" }}
            >
              <img
                src={workspaceLogoUrl}
                alt=""
                className="h-full w-full object-contain"
              />
            </span>
          ) : null}
          <span
            className="text-[11px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Preparing your receipt…
          </span>
          <Loader2
            className="h-3 w-3 animate-spin"
            style={{ color: "var(--muted-foreground)" }}
          />
        </div>
      </section>
    </div>
  );
}

export default function PaymentVerification() {
  const { attemptKey = "" } = useParams();
  const [state, setState] = useState<VerificationState>("checking");
  const [result, setResult] = useState<PublicOrderStatus | null>(null);
  const [urlWorkspace] = useState(readUrlWorkspace);
  const [message, setMessage] = useState("");
  const [showSuccessReveal, setShowSuccessReveal] = useState(false);
  const [redirectCountdown, setRedirectCountdown] = useState(
    orderReviewRedirectSeconds,
  );

  useEffect(() => {
    if (state !== "confirmed") return;
    setShowSuccessReveal(true);
    const timer = window.setTimeout(() => {
      setShowSuccessReveal(false);
    }, successRevealMs);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state === "confirmed" && result?.form?.id) {
      clearPublicCheckoutDrafts(result.form.id);
    }
  }, [result?.form?.id, state]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const startedAt = Date.now();
    const revealTerminal = (apply: () => void) => {
      const wait = Math.max(0, minVerifyDisplayMs - (Date.now() - startedAt));
      window.setTimeout(() => {
        if (active) apply();
      }, wait);
    };
    const check = async () => {
      attempts += 1;
      try {
        const next = await getPublicOrderStatus(attemptKey);
        if (!active) return;
        setResult(next);
        if (next.status === "confirmed") {
          revealTerminal(() => setState("confirmed"));
          return;
        }
        if (next.status === "failed" || next.status === "expired") {
          revealTerminal(() => {
            setState("failed");
            setMessage(
              "The payment was not completed. You can return and try again.",
            );
          });
          return;
        }
        if (attempts >= 15) {
          revealTerminal(() => setState("processing"));
          return;
        }
        timer = setTimeout(check, 2_000);
      } catch (error) {
        if (!active) return;
        if (attempts >= 3) {
          revealTerminal(() => {
            setState("failed");
            setMessage(
              error instanceof Error
                ? error.message
                : "This payment could not be verified.",
            );
          });
          return;
        }
        timer = setTimeout(check, 2_000);
      }
    };
    void check();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [attemptKey]);

  const redirectUrl =
    result?.confirmation.type !== "message"
      ? result?.confirmation.redirectUrl.trim()
      : "";
  const formConfirmationUrl = result?.form?.publicUrl
    ? `${result.form.publicUrl}${result.form.publicUrl.includes("?") ? "&" : "?"}payment_attempt=${encodeURIComponent(attemptKey)}`
    : "";

  useEffect(() => {
    if (state !== "confirmed" || !redirectUrl) return;
    setRedirectCountdown(orderReviewRedirectSeconds);
    const interval = window.setInterval(() => {
      setRedirectCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          window.location.assign(redirectUrl);
          return 0;
        }
        return current - 1;
      });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [redirectUrl, state]);

  const knownWorkspace = result?.workspace || urlWorkspace || null;
  const brandKnown = Boolean(knownWorkspace);
  const workspace = knownWorkspace || fallbackWorkspace;
  const accent = knownWorkspace?.accentColor || fallbackAccent;
  const themeVars = useMemo(
    () =>
      publicThemeVariables({
        accent,
        background: "#ffffff",
        border: "#e3e3e0",
        foreground: "#171719",
        muted: "#707077",
        radius: "12px",
        surface: "#f4f4f3",
      }),
    [accent],
  );
  const paidAt = result?.order.paidAt
    ? new Date(result.order.paidAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";
  const billingLines = result
    ? addressLines(result.order.billingDetails)
    : [];
  const purchasedTickets = result
    ? result.order.tickets?.length
      ? result.order.tickets
      : result.order.ticket
        ? [result.order.ticket]
        : []
    : [];

  return (
    <div
      className="public-theme hide-scrollbar min-h-screen"
      style={{
        ...themeVars,
        backgroundColor: "#f8f8f7",
        color: "#171719",
      }}
    >
      {state === "checking" && (
        <VerificationProgress
          accent={accent}
          brandKnown={brandKnown}
          provider={result?.order.provider || ""}
          workspaceLogoUrl={workspace.logoUrl}
          workspaceName={workspace.name}
        />
      )}

      {state === "processing" && (
        <div className="public-theme flex min-h-screen items-center justify-center px-5 py-12">
          <StatusScreen
            accent={accent}
            icon={Clock3}
            title="Payment is still being confirmed"
            description="You can close this page. We will email you as soon as the provider finishes confirming the payment."
            actions={
              <Button
                type="button"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="h-4 w-4" />
                Check again
              </Button>
            }
          />
        </div>
      )}

      {state === "failed" && (
        <div className="public-theme flex min-h-screen items-center justify-center px-5 py-12">
          <StatusScreen
            accent={accent}
            icon={CreditCard}
            title="Payment not completed"
            description={message}
            actions={
              <Button
                asChild
                style={{ backgroundColor: accent, color: readableColorOn(accent) }}
              >
                <Link to={result?.retryUrl || "/"}>Return and try again</Link>
              </Button>
            }
          />
        </div>
      )}

      {state === "confirmed" && result && showSuccessReveal && (
        <SuccessAnimation
          accent={accent}
          amount={result.order.amount}
          currency={result.order.currency}
          workspaceLogoUrl={workspace.logoUrl}
          workspaceName={workspace.name}
        />
      )}

      {state === "confirmed" && result && !showSuccessReveal && (
        <main className="mx-auto max-w-[820px] px-4 pb-16 pt-10 sm:px-5 sm:pt-16">
          <div className="mx-auto max-w-[600px]">
            <div className="text-center">
              <span
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
                style={{ backgroundColor: `${accent}14` }}
              >
                <CheckCircle2 className="h-8 w-8" style={{ color: accent }} />
              </span>
              <h1 className="mt-5 text-[26px] font-semibold leading-tight sm:text-[30px]">
                Thank you, payment confirmed
              </h1>
              <p
                className="mx-auto mt-2 max-w-[440px] text-[13px] leading-6"
                style={{ color: "var(--muted-foreground)" }}
              >
                Thanks{" "}
                {displayName(result.order.billingDetails, result.order.customerName)}
                , your order with {workspace.name} is confirmed. Your receipt
                and payment details are below.
              </p>
            </div>

            <section
              className="mt-8 overflow-hidden border bg-white shadow-[0_16px_44px_rgba(15,23,42,0.08)]"
              style={{
                borderColor: "var(--border)",
                borderRadius: "var(--radius)",
              }}
            >
              <div
                className="border-b px-6 py-7 text-center sm:px-8"
                style={{ borderColor: "var(--border)" }}
              >
                <p
                  className="text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: accent }}
                >
                  Total paid
                </p>
                <p className="mt-2 text-[36px] font-bold leading-none tabular-nums sm:text-[42px]">
                  {formatCurrency(result.order.amount, result.order.currency)}
                </p>
                <p
                  className="mt-2 text-[12px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Order {result.order.number}
                  {paidAt ? ` • ${paidAt}` : ""} •{" "}
                  {providerName(result.order.provider)}
                </p>
              </div>

              <div className="px-6 py-6 sm:px-8">
                <div
                  className="grid gap-3 border-b pb-5 text-[12px] sm:grid-cols-3"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div>
                    <p style={{ color: "var(--muted-foreground)" }}>Order number</p>
                    <p className="mt-1 break-all font-medium">{result.order.number}</p>
                  </div>
                  <div>
                    <p style={{ color: "var(--muted-foreground)" }}>Payment method</p>
                    <p className="mt-1 font-medium">{providerName(result.order.provider)}</p>
                  </div>
                  {result.order.providerReference && (
                    <div>
                      <p style={{ color: "var(--muted-foreground)" }}>Transaction reference</p>
                      <p className="mt-1 break-all font-medium">{result.order.providerReference}</p>
                    </div>
                  )}
                </div>
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {result.order.items.map((item) => (
                    <div
                      key={`${item.name}-${item.unitPrice}`}
                      className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{item.name}</p>
                        <p
                          className="mt-0.5 text-[11px]"
                          style={{ color: "var(--muted-foreground)" }}
                        >
                          {item.quantity} x{" "}
                          {formatCurrency(item.unitPrice, result.order.currency)}
                        </p>
                      </div>
                      <p className="shrink-0 text-[13px] font-semibold tabular-nums">
                        {formatCurrency(item.totalAmount, result.order.currency)}
                      </p>
                    </div>
                  ))}
                </div>

                <div
                  className="mt-4 space-y-2 border-t pt-4 text-[13px]"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-center justify-between gap-4">
                    <span style={{ color: "var(--muted-foreground)" }}>
                      Subtotal
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(result.order.subtotal, result.order.currency)}
                    </span>
                  </div>
                  {result.order.discountAmount > 0 && (
                    <div className="flex items-center justify-between gap-4">
                      <span style={{ color: "var(--muted-foreground)" }}>
                        Discount
                      </span>
                      <span className="font-medium tabular-nums">
                        -{formatCurrency(result.order.discountAmount, result.order.currency)}
                      </span>
                    </div>
                  )}
                  {result.order.taxAmount > 0 && (
                    <div className="flex items-center justify-between gap-4">
                      <span style={{ color: "var(--muted-foreground)" }}>
                        Tax
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(result.order.taxAmount, result.order.currency)}
                      </span>
                    </div>
                  )}
                  <div
                    className="flex items-center justify-between gap-4 border-t pt-3"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <span className="font-semibold">Total paid</span>
                    <span className="text-[18px] font-semibold tabular-nums">
                      {formatCurrency(result.order.amount, result.order.currency)}
                    </span>
                  </div>
                </div>
              </div>

              <div
                className="grid gap-6 border-t px-6 py-6 text-[12px] sm:grid-cols-2 sm:px-8"
                style={{
                  backgroundColor: "hsl(var(--surface-muted))",
                  borderColor: "var(--border)",
                }}
              >
                <div>
                  <p
                    className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    <UserRound className="h-3.5 w-3.5" />
                    Billed to
                  </p>
                  <p className="mt-2 font-medium">
                    {displayName(result.order.billingDetails, result.order.customerName)}
                  </p>
                  <p className="mt-0.5 wrap-break-word" style={{ color: "var(--muted-foreground)" }}>
                    {result.order.customerEmail}
                  </p>
                </div>
                {billingLines.length > 0 && (
                  <div>
                    <p
                      className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      Billing address
                    </p>
                    <div className="mt-2 space-y-0.5 font-medium">
                      {billingLines.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div
                className="flex flex-col gap-3 border-t px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  {formConfirmationUrl && (
                    <Button
                      type="button"
                      className="w-full sm:w-auto"
                      onClick={() => window.location.assign(formConfirmationUrl)}
                      style={{
                        backgroundColor: accent,
                        color: readableColorOn(accent),
                      }}
                    >
                      View form confirmation
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={() => void downloadOrderReceipt(result.order, workspace)}
                  >
                    <Download className="h-4 w-4" />
                    Download receipt
                  </Button>
                </div>
                {paidAt && (
                  <span
                    className="flex items-center gap-1.5 text-[11px]"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    <Mail className="h-3.5 w-3.5" />
                    A copy was sent to {result.order.customerEmail}
                  </span>
                )}
              </div>
            </section>

            {result.eventAccess?.joinUrl && (
              <section
                className="mt-6 border p-5"
                style={{
                  backgroundColor: `${accent}0F`,
                  borderColor: `${accent}33`,
                  borderRadius: "var(--radius)",
                }}
              >
                <p className="text-[14px] font-semibold">Your online access</p>
                <p className="mt-1 text-[12px] leading-5" style={{ color: "var(--muted-foreground)" }}>
                  {result.eventAccess.meetingProvider || "Online meeting"} for {result.eventAccess.eventTitle}. Keep this link private.
                </p>
                <a
                  href={result.eventAccess.joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-2 text-[12px] font-semibold underline underline-offset-4"
                  style={{ color: accent }}
                >
                  Open meeting link
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </section>
            )}

            {(redirectUrl || result.confirmation.message) && (
              <section
                className="mt-6 flex flex-col gap-4 border p-4 sm:flex-row sm:items-center sm:justify-between"
                style={{
                  backgroundColor: `${accent}0F`,
                  borderColor: `${accent}33`,
                  borderRadius: "var(--radius)",
                }}
              >
                <div>
                  <p className="text-[13px] font-semibold">
                    {result.confirmation.title ||
                      (redirectUrl ? "Next step" : "Response received")}
                  </p>
                  <p
                    className="mt-1 text-[12px] leading-5"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {result.confirmation.message
                      ? `${result.confirmation.message} `
                      : ""}
                    {redirectUrl &&
                      `Redirecting in ${redirectCountdown} seconds so you have time to review your order.`}
                  </p>
                </div>
                {redirectUrl && (
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    onClick={() => window.location.assign(redirectUrl)}
                    style={{
                      backgroundColor: accent,
                      color: readableColorOn(accent),
                    }}
                  >
                    Continue now
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </section>
            )}

            {purchasedTickets.map((ticket, index) => (
              <ConfirmedTicket
                key={ticket.number || `${ticket.code}-${index}`}
                accent={accent}
                index={index}
                ticket={ticket}
                total={purchasedTickets.length}
                workspaceName={workspace.name}
              />
            ))}
          </div>
        </main>
      )}
    </div>
  );
}

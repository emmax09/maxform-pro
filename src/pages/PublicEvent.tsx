import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarDays,
  ExternalLink,
  KeyRound,
  Loader2,
  LockKeyhole,
  MapPin,
  Ticket,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import type {
  EventRecord,
  EventTicketType,
} from "@/components/events/event-types";
import { EventPublicSections } from "@/components/events/EventPublicSections";
import { PublicPreloader } from "@/components/shared/PublicPreloader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePersistentQuery } from "@/hooks/use-persistent-query";
import {
  getPublicEvent,
  verifyPublicEventInvitation,
  verifyPublicEventPassword,
} from "@/lib/events";
import { persistentCacheKey } from "@/lib/performance/indexed-cache";
import { publicThemeVariables, readableColorOn } from "@/lib/public-theme";
import { formatCurrency } from "@/lib/regional-options";
import { cn } from "@/lib/utils";

type PublicEventData = {
  event: EventRecord;
  ownerShortId: string;
  registrationFormSlug: string;
  ticketTypes: EventTicketType[];
};

// Neutral, non-branded placeholder - never the "wrong" brand color, just a
// placeholder shown only until the event's real theme is known.
const neutralAccent = "#707077";

const neutralPageStyle = {
  ...publicThemeVariables({
    accent: neutralAccent,
    background: "#FFFFFF",
    border: "#E0E2E7",
    foreground: "#17181A",
    muted: "#666A73",
    radius: "6px",
    surface: "#FFFFFF",
  }),
  backgroundColor: "#FFFFFF",
  color: "#17181A",
};

const eventThemeVariables = (event: EventRecord) =>
  publicThemeVariables({
    accent: event.branding.accentColor,
    background: event.branding.backgroundColor,
    border: event.branding.borderColor,
    foreground: event.branding.textColor,
    muted: event.branding.mutedTextColor,
    radius: `${event.branding.cornerRadius}px`,
    surface: event.branding.surfaceColor,
  });

const formatCalendarDate = (value: string, style: "medium" | "full" = "full") =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: style }).format(
        new Date(`${value}T00:00:00`),
      )
    : "";

const formatTime = (value: string) => {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2020, 0, 1, hours, minutes));
};

const formatTimeSpan = (startTime: string, endTime: string) => {
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  return start ? (end ? `${start} - ${end}` : `Starts ${start}`) : "";
};

export default function PublicEvent() {
  const { eventSlug = "", workspaceId } = useParams();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite") || "";
  const [data, setData] = useState<PublicEventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [completedPreloaderKey, setCompletedPreloaderKey] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [accessStatus, setAccessStatus] = useState<
    "checking" | "granted" | "locked"
  >("checking");
  const [password, setPassword] = useState("");
  const [accessError, setAccessError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const eventQuery = usePersistentQuery<PublicEventData | null>({
    cacheKey: persistentCacheKey(
      "events",
      "public",
      workspaceId ? `${workspaceId}:${eventSlug}` : eventSlug,
    ),
    cacheScope: "events",
    enabled: Boolean(eventSlug),
    persist: false,
    queryFn: () => getPublicEvent(eventSlug, workspaceId),
    queryKey: ["events", "public", workspaceId || "__none", eventSlug || "__none"],
    refetchOnMount: "always",
    staleTime: 0,
    tags: ["events", "public-events"],
  });

  useEffect(() => {
    let active = true;
    setNotFound(false);
    setAccessStatus("checking");
    setAccessError("");
    const applyEvent = async (result: PublicEventData | null) => {
      if (!active) return;
      if (!result) {
        setNotFound(true);
        setData(null);
        setLoading(false);
        return;
      }
      setData(result);
      if (result.event.accessControl === "public") {
        setAccessStatus("granted");
      } else if (result.event.accessControl === "password") {
        const sessionKey = `maxform:event-access:${result.event.id}`;
        setAccessStatus(
          sessionStorage.getItem(sessionKey) === "granted"
            ? "granted"
            : "locked",
        );
      } else {
        const validInvitation = await verifyPublicEventInvitation(
          eventSlug,
          inviteToken,
          workspaceId,
        );
        if (active) {
          setAccessStatus(validInvitation ? "granted" : "locked");
        }
      }
      if (active) setLoading(false);
    };

    if (eventQuery.data !== undefined) {
      void applyEvent(eventQuery.data);
    } else if (eventQuery.isError) {
      setNotFound(true);
      setLoading(false);
    } else {
      setLoading(eventQuery.isInitialLoading);
    }
    return () => {
      active = false;
    };
  }, [
    eventQuery.data,
    eventQuery.isError,
    eventQuery.isInitialLoading,
    eventSlug,
    inviteToken,
    workspaceId,
  ]);

  const preloader = data?.event.branding.preloader;
  const preloaderKey =
    data && preloader?.enabled && Number(preloader.durationSeconds) > 0
      ? `${data.event.id}:${preloader.durationSeconds}`
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

  const unlockWithPassword = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!data || !password) return;
    setUnlocking(true);
    setAccessError("");
    try {
      const valid = await verifyPublicEventPassword(
        eventSlug,
        password,
        workspaceId,
      );
      if (!valid) {
        setAccessError("That password did not match. Check it and try again.");
        return;
      }
      sessionStorage.setItem(
        `maxform:event-access:${data.event.id}`,
        "granted",
      );
      setAccessStatus("granted");
      setPassword("");
    } catch {
      setAccessError("We could not verify access right now. Please try again.");
    } finally {
      setUnlocking(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-dvh bg-white" aria-label="Loading event" />
    );
  }

  if (notFound || !data) {
    return (
      <main
        className="grid min-h-dvh place-items-center px-6 text-center"
        style={neutralPageStyle}
      >
        <div>
          <Ticket className="mx-auto h-8 w-8 text-[#707077]" />
          <h1 className="mt-5 text-[24px] font-semibold">
            This event is not available
          </h1>
          <p className="mt-2 text-[13px] text-[#707077]">
            It may still be a draft, or the public link has changed.
          </p>
          <Button
            asChild
            className="mt-6"
            style={{
              backgroundColor: neutralAccent,
              color: readableColorOn(neutralAccent),
            }}
          >
            <Link to="/">Return to MaxForm</Link>
          </Button>
        </div>
      </main>
    );
  }

  const { event, ownerShortId, registrationFormSlug, ticketTypes } = data;
  const eventVars = eventThemeVariables(event);
  if (showingPreloader) {
    return <PublicPreloader settings={event.branding.preloader} />;
  }
  if (accessStatus === "checking") {
    return (
      <main
        className="min-h-dvh"
        style={{
          ...eventVars,
          backgroundColor: event.branding.backgroundColor,
          color: event.branding.textColor,
          fontFamily: event.branding.fontFamily,
        }}
      />
    );
  }
  if (accessStatus !== "granted") {
    const passwordProtected = event.accessControl === "password";
    return (
      <main
        className="grid min-h-dvh place-items-center px-5 py-12"
        style={{
          ...eventVars,
          backgroundColor: event.branding.backgroundColor,
          color: event.branding.textColor,
          fontFamily: event.branding.fontFamily,
        }}
      >
        <div
          className="w-full max-w-[440px] border-y py-9 text-center"
          style={{ borderColor: event.branding.borderColor }}
        >
          <span
            className="mx-auto flex h-11 w-11 items-center justify-center"
            style={{
              backgroundColor: `${event.branding.accentColor}1A`,
              color: event.branding.accentColor,
            }}
          >
            {passwordProtected ? (
              <LockKeyhole className="h-5 w-5" />
            ) : (
              <KeyRound className="h-5 w-5" />
            )}
          </span>
          <h1 className="mt-5 text-[22px] font-semibold">
            {passwordProtected
              ? "This event is password protected"
              : "A private invitation is required"}
          </h1>
          <p
            className="mx-auto mt-2 max-w-[360px] text-[13px] leading-6"
            style={{ color: event.branding.mutedTextColor }}
          >
            {passwordProtected
              ? "Enter the password provided by the event organizer to continue."
              : event.inviteMessage ||
                "Open the complete invitation link sent by the event organizer."}
          </p>
          {passwordProtected && (
            <form
              onSubmit={unlockWithPassword}
              className="mx-auto mt-6 max-w-[340px] text-left"
            >
              <Label htmlFor="public-event-password">Event password</Label>
              <Input
                id="public-event-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(input) => {
                  setPassword(input.target.value);
                  setAccessError("");
                }}
                className="mt-2"
                aria-invalid={Boolean(accessError)}
              />
              {accessError && (
                <p
                  className="mt-2 text-[11px] leading-5"
                  style={{ color: "#d73737" }}
                >
                  {accessError}
                </p>
              )}
              <Button
                type="submit"
                className="mt-4 w-full"
                disabled={!password || unlocking}
                style={{
                  backgroundColor: event.branding.accentColor,
                  color: event.branding.buttonTextColor,
                }}
              >
                {unlocking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Continue
              </Button>
            </form>
          )}
          {!passwordProtected && (
            <Button
              asChild
              variant="outline"
              className="mt-6 bg-transparent"
              style={{
                borderColor: event.branding.borderColor,
                color: event.branding.textColor,
              }}
            >
              <Link to="/">Return to MaxForm</Link>
            </Button>
          )}
        </div>
      </main>
    );
  }
  const accent = event.branding.accentColor;
  const contentWidth = {
    narrow: 960,
    standard: 1120,
    wide: 1280,
  }[event.branding.contentWidth];
  const heroHeight = {
    compact: "min(560px, 62dvh)",
    standard: "min(700px, 72dvh)",
    immersive: "min(820px, 82dvh)",
  }[event.branding.heroHeight];
  const centeredHero = event.branding.heroAlignment === "center";
  const activeDiscounts =
    event.pricing.discountsEnabled && !event.ticketingEnabled
      ? event.discountRules.filter((rule) => rule.active)
      : [];
  const registrationUrl = registrationFormSlug
    ? `/forms/${ownerShortId}/${registrationFormSlug}`
    : "";
  const location =
    event.locationType === "online"
      ? "Online event"
      : [event.venueName, event.address].filter(Boolean).join(", ") ||
        "Venue to be announced";
  const date =
    event.scheduleType === "single_day"
      ? event.eventDate
        ? [
            formatCalendarDate(event.eventDate),
            formatTimeSpan(event.startTime, event.endTime),
          ]
            .filter(Boolean)
            .join(" / ")
        : "Date to be announced"
      : event.rangeStartDate && event.rangeEndDate
        ? [
            `${formatCalendarDate(event.rangeStartDate)} - ${formatCalendarDate(event.rangeEndDate)}`,
            event.rangeScheduleMode === "daily"
              ? "Times vary by day"
              : formatTimeSpan(event.startTime, event.endTime),
          ]
            .filter(Boolean)
            .join(" / ")
        : "Date to be announced";

  return (
    <main
      className="min-h-dvh overflow-x-hidden"
      style={{
        ...eventVars,
        backgroundColor: event.branding.backgroundColor,
        color: event.branding.textColor,
        fontFamily: event.branding.fontFamily,
      }}
    >
      <section
        className="relative overflow-hidden"
        style={{
          backgroundColor: event.branding.heroBackgroundColor,
          color: event.branding.heroTextColor,
          minHeight: heroHeight,
        }}
      >
        {event.branding.coverImageUrl && (
          <img
            src={event.branding.coverImageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {event.branding.coverImageUrl && (
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: event.branding.heroBackgroundColor,
              opacity: event.branding.heroOverlayOpacity / 100,
            }}
          />
        )}
        <div
          className="absolute inset-x-0 bottom-0 h-1.5"
          style={{ backgroundColor: accent }}
        />
        <div
          className="relative mx-auto flex flex-col px-5 py-7 sm:px-8 sm:py-9 lg:px-10"
          style={{ maxWidth: contentWidth, minHeight: heroHeight }}
        >
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-4",
              centeredHero && "justify-center",
            )}
          >
            {event.branding.logoUrl ? (
              <img
                src={event.branding.logoUrl}
                alt=""
                className="max-h-11 max-w-[min(180px,55vw)] object-contain object-left"
              />
            ) : (
              <span className="text-[14px] font-semibold">
                {event.title}
              </span>
            )}
            <span
              className="px-3 py-1.5 text-[11px] font-medium"
              style={{
                backgroundColor: event.branding.surfaceColor,
                borderRadius: event.branding.cornerRadius,
                color: event.branding.textColor,
                opacity: 0.94,
              }}
            >
              {event.status === "sold_out" ? "Sold out" : "Registration open"}
            </span>
          </div>
          <div
            className={cn(
              "mt-auto max-w-[850px] pb-6 pt-20 sm:pb-8",
              centeredHero && "mx-auto text-center",
            )}
          >
            <p className="text-[12px] font-semibold uppercase opacity-75">
              {date}
            </p>
            <h1
              className="mt-4 wrap-break-word text-[38px] leading-[1.08] sm:text-[58px] lg:text-[64px]"
              style={{
                fontFamily: event.branding.headingFontFamily,
                fontWeight: event.branding.headingWeight,
              }}
            >
              {event.title}
            </h1>
            <p
              className={cn(
                "mt-5 flex items-start gap-2 text-[14px] opacity-80",
                centeredHero && "justify-center",
              )}
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              {location}
            </p>
            {event.locationType !== "physical" && (
              <p className={cn("mt-2 text-[12px] opacity-75", centeredHero && "text-center")}>
                {event.locationType === "hybrid" ? "Hybrid event · Online attendance available" : "Online event"}
                {String(event.settings.meetingProvider || "") && ` · ${String(event.settings.meetingProvider)}`}
              </p>
            )}
          </div>
        </div>
      </section>

      <section
        className="mx-auto grid min-w-0 gap-10 px-5 py-10 sm:px-8 sm:py-12 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12 lg:px-10"
        style={{ maxWidth: contentWidth }}
      >
        <div className="min-w-0">
          {event.scheduleType === "date_range" &&
            event.rangeScheduleMode === "daily" &&
            event.dailySchedule.length > 0 && (
              <section className="mb-10 border-y py-6" style={{ borderColor: event.branding.borderColor }}>
                <h2
                  className="text-[20px] font-semibold"
                  style={{
                    fontFamily: event.branding.headingFontFamily,
                    fontWeight: event.branding.headingWeight,
                  }}
                >
                  Daily schedule
                </h2>
                <div className="mt-4 divide-y" style={{ borderColor: event.branding.borderColor }}>
                  {event.dailySchedule.map((schedule) => (
                    <div
                      key={schedule.date}
                      className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5"
                    >
                      <p className="text-[13px] font-medium">
                        {formatCalendarDate(schedule.date, "full")}
                      </p>
                      <p
                        className="text-[12px]"
                        style={{ color: event.branding.mutedTextColor }}
                      >
                        {formatTimeSpan(schedule.startTime, schedule.endTime)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          <EventPublicSections event={event} />
        </div>

        <aside
          className="min-w-0 self-start border p-5 sm:p-6 lg:sticky lg:top-6"
          style={{
            backgroundColor: event.branding.surfaceColor,
            borderColor: event.branding.borderColor,
            borderRadius: event.branding.cornerRadius,
          }}
        >
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" style={{ color: accent }} />
            <p className="text-[13px] font-semibold">
              {event.ticketingEnabled ? "Tickets" : "Registration"}
            </p>
          </div>
          {event.ticketingEnabled ? (
            <div className="mt-5">
              <p className="text-[16px] font-semibold">Available tickets</p>
              <p
                className="mt-2 text-[12px] leading-6"
                style={{ color: event.branding.mutedTextColor }}
              >
                Preview the ticket options here. You will choose a ticket and
                quantity after entering your registration details.
              </p>
              <div className="mt-5 space-y-2">
                {ticketTypes.filter((ticket) => ticket.active).length ? (
                  ticketTypes
                    .filter((ticket) => ticket.active)
                    .map((ticket) => {
                      const remaining = Math.max(
                        0,
                        ticket.quantityAvailable - ticket.soldCount,
                      );
                      return (
                        <div
                          key={ticket.id}
                          className="border p-3"
                          style={{
                            borderColor: event.branding.borderColor,
                            borderRadius: event.branding.cornerRadius,
                          }}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-semibold">
                                {ticket.name}
                              </p>
                              {ticket.description && (
                                <p
                                  className="mt-1 line-clamp-2 text-[10px] leading-4"
                                  style={{ color: event.branding.mutedTextColor }}
                                >
                                  {ticket.description}
                                </p>
                              )}
                            </div>
                            <p className="shrink-0 text-[12px] font-semibold">
                              {ticket.price > 0
                                ? formatCurrency(ticket.price, ticket.currency)
                                : "Free"}
                            </p>
                          </div>
                          <div
                            className="mt-3 flex items-center justify-between text-[9px] uppercase tracking-wide"
                            style={{ color: event.branding.mutedTextColor }}
                          >
                            <span>{remaining > 0 ? `${remaining} remaining` : "Sold out"}</span>
                            <span>Select during registration</span>
                          </div>
                        </div>
                      );
                    })
                ) : (
                  <p
                    className="border-y py-4 text-[11px]"
                    style={{
                      borderColor: event.branding.borderColor,
                      color: event.branding.mutedTextColor,
                    }}
                  >
                    Ticket options are being prepared.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <p className="text-[16px] font-semibold">Reserve your place</p>
              <p
                className="mt-2 text-[12px] leading-6"
                style={{ color: event.branding.mutedTextColor }}
              >
                Complete the registration form to confirm your attendance.
              </p>
              {event.pricing.enabled && (
                <div
                  className="mt-5 border-y py-4"
                  style={{ borderColor: event.branding.borderColor }}
                >
                  <p
                    className="text-[10px] font-semibold uppercase"
                    style={{ color: event.branding.mutedTextColor }}
                  >
                    {event.pricing.label}
                  </p>
                  <p
                    className="mt-2 text-[24px]"
                    style={{
                      fontFamily: event.branding.headingFontFamily,
                      fontWeight: event.branding.headingWeight,
                    }}
                  >
                    {formatCurrency(
                      event.pricing.amount,
                      event.pricing.currency,
                    )}
                  </p>
                  {event.pricing.taxIncluded && (
                    <p
                      className="mt-1 text-[10px]"
                      style={{ color: event.branding.mutedTextColor }}
                    >
                      Tax included
                    </p>
                  )}
                </div>
              )}
              {activeDiscounts.length > 0 && (
                <div className="mt-4 space-y-2">
                  {activeDiscounts.slice(0, 3).map((discount) => (
                    <div
                      key={discount.id}
                      className="flex items-start gap-2 text-[11px]"
                      style={{ color: event.branding.mutedTextColor }}
                    >
                      <span
                        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: accent }}
                      />
                      <span>
                        {discount.name}:{" "}
                        {discount.valueType === "percentage"
                          ? `${discount.value}% off`
                          : `${formatCurrency(
                              discount.value,
                              event.pricing.currency,
                            )} off`}
                        {discount.mode === "first_n"
                          ? ` for the first ${discount.firstN}`
                          : discount.mode === "group_size"
                            ? ` for groups of ${discount.minQuantity}+`
                            : discount.mode === "promo_code"
                              ? ` with code ${discount.code}`
                              : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {registrationUrl ? (
            <Button
              asChild
              className="mt-5 w-full"
              style={{
                backgroundColor: accent,
                borderRadius: event.branding.cornerRadius,
                color: event.branding.buttonTextColor,
              }}
            >
              <Link to={registrationUrl}>
                {event.status === "sold_out"
                  ? "Join waitlist"
                  : event.ticketingEnabled
                    ? "Continue to registration"
                    : "Register"}
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <Button
              className="mt-5 w-full"
              disabled
              style={{
                backgroundColor: event.branding.surfaceColor,
                borderColor: event.branding.borderColor,
                borderRadius: event.branding.cornerRadius,
                color: event.branding.mutedTextColor,
              }}
            >
              Registration unavailable
            </Button>
          )}
          {event.ticketingEnabled && event.refundPolicy && (
            <p
              className="mt-4 text-[10px] leading-5"
              style={{ color: event.branding.mutedTextColor }}
            >
              {event.refundPolicy}
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}

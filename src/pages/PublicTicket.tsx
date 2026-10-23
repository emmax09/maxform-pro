import {
  CalendarPlus,
  CheckCircle2,
  Download,
  Loader2,
  MapPin,
  Ticket as TicketIcon,
} from "lucide-react";
import html2canvas from "html2canvas";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import type { TicketCanvasElement } from "@/components/events/event-types";
import { TicketSurface } from "@/components/events/ticket-surface";
import { Button } from "@/components/ui/button";
import type { PublicIssuedEventTicket } from "@/lib/checkout";
import {
  getPublicTicketDownload,
  type PublicTicketDownload,
} from "@/lib/ticket-download";
import { publicThemeVariables, readableColorOn } from "@/lib/public-theme";
import { formatCurrency } from "@/lib/regional-options";
import type { TicketElementResolver, TicketTheme } from "@/lib/ticket-theme";

const fallbackTicketTheme: TicketTheme = {
  accent: "#F93D0A",
  background: "#FFFFFF",
  edge: "solid",
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

const ticketResolver = (
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
    typeof ticket.seo?.description === "string" ? ticket.seo.description : "";
  return (element) => {
    const captioned = (text: string) => ({ caption: element.label, text });
    switch (element.type) {
      case "event_name": return { text: ticket.eventTitle };
      case "event_tagline": return { text: seoDescription || ticket.eventDescription };
      case "event_details": return captioned([eventDate, eventTime, ticket.venue || ticket.location].filter(Boolean).join(" · "));
      case "event_date": return captioned(eventDate);
      case "event_time": return captioned(eventTime);
      case "venue": return captioned(ticket.venue || ticket.location);
      case "address": return captioned(ticket.location);
      case "organizer": return captioned(workspaceName);
      case "attendee_name": return captioned(ticket.attendeeName);
      case "attendee_email": return captioned(ticket.attendeeEmail);
      case "ticket_type": return captioned(ticket.ticketType);
      case "ticket_price": return captioned(ticket.price ? formatCurrency(ticket.price, ticket.currency) : "Free");
      case "ticket_number": return captioned(ticket.number);
      case "order_code": return captioned(ticket.orderCode);
      case "event_code": return captioned(ticket.eventCode);
      case "terms": return { text: element.value || ticket.terms || element.label };
      default: return { text: element.value || element.label };
    }
  };
};

const downloadTicketImage = async (
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
  canvas.height = rendered.reduce((height, item) => height + item.height, 0) + gap * Math.max(0, rendered.length - 1);
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
  link.download = `${(ticket.number || "event-ticket").replace(/[^A-Za-z0-9_-]+/g, "-")}.png`;
  link.click();
};

function TicketCard({
  index,
  ticket,
  total,
  workspaceName,
}: {
  index: number;
  ticket: PublicIssuedEventTicket;
  total: number;
  workspaceName: string;
}) {
  const artworkRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const resolve = useMemo(
    () => ticketResolver(ticket, workspaceName),
    [ticket, workspaceName],
  );
  const design = ticket.design;
  const theme = useMemo(
    () => ({ ...fallbackTicketTheme, ...(design?.theme || {}) }),
    [design?.theme],
  );
  const frontLayout = design?.frontLayout?.length ? design.frontLayout : fallbackTicketFront;
  const backLayout = design?.backLayout?.length ? design.backLayout : fallbackTicketBack;
  const eventDate = ticketDatePart(ticket.startsAt, ticket.timezone, { dateStyle: "medium" });

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xs">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            {total > 1 ? `Ticket ${index + 1} of ${total}` : "Event ticket"}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-950">{ticket.eventTitle}</h2>
          <p className="mt-1 text-sm text-zinc-600">{ticket.ticketType} · {ticket.number}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {eventDate && <span>{eventDate}</span>}
            {ticket.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{ticket.location}</span>}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!ticket.code || downloading}
          onClick={() => {
            if (!artworkRef.current || downloading) return;
            setDownloading(true);
            setDownloadFailed(false);
            void downloadTicketImage(ticket, artworkRef.current)
              .catch(() => setDownloadFailed(true))
              .finally(() => setDownloading(false));
          }}
        >
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {downloading ? "Preparing…" : "Download ticket"}
        </Button>
      </div>
      {downloadFailed && <p className="px-5 pb-4 text-xs text-rose-600 sm:px-6">The ticket image could not be prepared. Please try again.</p>}
      <div ref={artworkRef} className="space-y-5 border-t border-zinc-200 bg-zinc-100 p-4 sm:p-6">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Front</p>
          <TicketSurface elements={frontLayout} flat qrValue={ticket.code || ticket.number} resolve={resolve} side="front" theme={theme} ticketNumber={ticket.number} />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Back</p>
          <TicketSurface elements={backLayout} flat qrValue={ticket.code || ticket.number} resolve={resolve} side="back" theme={theme} ticketNumber={ticket.number} />
        </div>
      </div>
    </section>
  );
}

export default function PublicTicket() {
  const { downloadToken = "" } = useParams();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [result, setResult] = useState<PublicTicketDownload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setState("loading");
    setError("");
    void getPublicTicketDownload(downloadToken)
      .then((value) => {
        if (!active) return;
        setResult(value);
        setState("ready");
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "This ticket link is unavailable.");
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [downloadToken]);

  if (state === "loading") {
    return <main className="flex min-h-dvh items-center justify-center bg-zinc-100 px-5 text-zinc-950"><div className="text-center" role="status"><Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-600" /><p className="mt-3 text-sm text-zinc-600">Opening your secure ticket</p></div></main>;
  }
  if (state === "error" || !result || !result.tickets.length) {
    return <main className="flex min-h-dvh items-center justify-center bg-zinc-100 px-5 text-zinc-950"><section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-xs"><TicketIcon className="mx-auto h-8 w-8 text-zinc-500" /><h1 className="mt-5 text-xl font-semibold">Ticket link unavailable</h1><p className="mt-2 text-sm leading-6 text-zinc-600">{error || "Ask the event organizer to send the ticket again."}</p></section></main>;
  }

  const accent = result.workspace.accentColor || "#F93D0A";
  const theme = {
    ...publicThemeVariables({ accent, background: "#F4F4F5", border: "#E4E4E7", foreground: "#18181B", muted: "#71717A", radius: "0.875rem", surface: "#FFFFFF" }),
    backgroundImage: `radial-gradient(circle at 50% 0%, ${accent}18, transparent 34rem)`,
  };
  return (
    <main className="min-h-dvh bg-zinc-100 px-4 py-8 text-zinc-950 sm:px-6 sm:py-12" style={theme}>
      <div className="mx-auto max-w-5xl">
        <header className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xs">
          <div className="h-1.5 w-full" style={{ backgroundColor: accent }} />
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/5" style={{ backgroundColor: result.workspace.logoUrl ? "#FFFFFF" : accent }}>
                {result.workspace.logoUrl ? <img src={result.workspace.logoUrl} alt={`${result.workspace.name} logo`} className="h-full w-full object-contain p-1.5" /> : <TicketIcon className="h-7 w-7" style={{ color: readableColorOn(accent) }} />}
              </div>
              <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: accent }}>Secure ticket page</p><h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">{result.workspace.name}</h1><p className="mt-1 text-sm text-zinc-600">Your issued event ticket{result.tickets.length > 1 ? "s" : ""} are ready.</p></div>
            </div>
            <div className="inline-flex items-center gap-2 self-start rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 sm:self-auto"><CheckCircle2 className="h-3.5 w-3.5" /> Issued and valid</div>
          </div>
        </header>
        <div className="mt-6 flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950"><CalendarPlus className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-xs leading-5">Keep this page private. Show the QR code or ticket number at the event entrance. This link contains only the ticket access needed for this order.</p></div>
        <div className="mt-6 space-y-6">{result.tickets.map((ticket, index) => <TicketCard key={ticket.number || ticket.code} index={index} ticket={ticket} total={result.tickets.length} workspaceName={result.workspace.name} />)}</div>
      </div>
    </main>
  );
}

import {
  useEffect,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  CalendarDays,
  Clock,
  Hash,
  Loader2,
  LockKeyhole,
  Mail,
  MapPin,
  Receipt,
  Ticket,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import QRCode from "qrcode";

import type {
  TicketCanvasElement,
  TicketElementType,
} from "@/components/events/event-types";
import { code128Bars } from "@/lib/code128";
import {
  TICKET_ASPECT,
  TICKET_STUB_X,
  ticketFontStack,
  ticketLuminance,
  ticketMotifStyle,
  ticketRgba,
  type TicketElementResolver,
  type TicketTheme,
} from "@/lib/ticket-theme";
import { cn } from "@/lib/utils";

// Container-query type ramp. These stay literal class names so Tailwind can
// see them and so they survive any serialization of the rendered ticket.
const TEXT_SIZE = {
  large: "text-[min(4.6cqw,44px)] leading-[1.05] tracking-[-0.02em]",
  medium: "text-[min(2.4cqw,23px)] leading-[1.2]",
  small: "text-[min(1.45cqw,14px)] leading-[1.45]",
} as const;

const BASE_FONT_SIZE = {
  large: "min(4.6cqw,44px)",
  medium: "min(2.4cqw,23px)",
  small: "min(1.45cqw,14px)",
} as const;

const CAPTION_CLASS =
  "text-[min(0.95cqw,10px)] tracking-[0.18em] leading-[1.4]";

const ELEMENT_ICONS: Partial<Record<TicketElementType, LucideIcon>> = {
  event_date: CalendarDays,
  event_time: Clock,
  venue: MapPin,
  address: MapPin,
  attendee_name: UserRound,
  attendee_email: Mail,
  ticket_type: Ticket,
  ticket_price: Receipt,
  ticket_number: Hash,
  order_code: Hash,
  event_code: Hash,
};

const textClassFor = (size: TicketCanvasElement["size"]) =>
  size === "large"
    ? TEXT_SIZE.large
    : size === "medium"
      ? TEXT_SIZE.medium
      : TEXT_SIZE.small;

const baseFontSize = (size: TicketCanvasElement["size"]) =>
  size === "large"
    ? BASE_FONT_SIZE.large
    : size === "medium"
      ? BASE_FONT_SIZE.medium
      : BASE_FONT_SIZE.small;

export function TicketQrCode({
  color,
  value,
}: {
  color: string;
  value: string;
}) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 360,
      color: {
        dark: color,
        light: "#FFFFFF",
      },
    }).then((url) => {
      if (active) setSource(url);
    });
    return () => {
      active = false;
    };
  }, [color, value]);
  return source ? (
    <img
      src={source}
      alt="Secure ticket QR code"
      className="h-full w-full object-contain"
    />
  ) : (
    <Loader2 className="h-5 w-5 animate-spin" />
  );
}

/** Real Code 128 subset B, drawn as SVG so it stays crisp at any size. */
export function TicketBarcode({
  color = "#111827",
  value,
}: {
  color?: string;
  value: string;
}) {
  const { bars, total } = code128Bars(value);
  if (!total) return null;
  return (
    <svg
      viewBox={`0 0 ${total} 40`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label={`Barcode ${value}`}
    >
      {bars.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={0}
          width={bar.width}
          height={40}
          fill={color}
        />
      ))}
    </svg>
  );
}

function TicketQrBlock({
  editable,
  element,
  qrValue,
  scanLabel,
  theme,
  ticketNumber,
}: {
  editable: boolean;
  element: TicketCanvasElement;
  qrValue: string;
  scanLabel: string;
  theme: TicketTheme;
  ticketNumber: string;
}) {
  const bare = Boolean(element.style?.hideCaption);
  return (
    <span className="flex w-full flex-col items-center gap-[4%]">
      <span
        className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-white p-[6%] text-zinc-900"
        style={{
          borderRadius: element.style?.borderRadius ?? "12%",
          boxShadow: bare
            ? undefined
            : `0 0 0 1px ${ticketRgba(theme.accent, 0.35)}`,
        }}
      >
        <TicketQrCode color="#111827" value={qrValue} />
        {editable && (
          <span className="absolute right-[6%] top-[6%] grid h-[22%] w-[22%] place-items-center rounded-[20%] bg-zinc-950 text-white">
            <LockKeyhole className="h-[60%] w-[60%]" />
          </span>
        )}
      </span>
      {!bare && (
        <>
          <span className="block w-full truncate text-center font-mono text-[min(1.1cqw,12px)] font-semibold tracking-tight">
            {ticketNumber}
          </span>
          <span
            className="block w-full truncate text-center text-[min(0.86cqw,9px)] uppercase tracking-[0.14em]"
            style={{ color: theme.muted }}
          >
            {scanLabel}
          </span>
        </>
      )}
    </span>
  );
}

function TicketMediaPlaceholder({
  element,
  theme,
}: {
  element: TicketCanvasElement;
  theme: TicketTheme;
}) {
  return (
    <span
      className={cn(
        "flex w-full items-center justify-center rounded-[6px] border border-dashed px-[6%] text-center uppercase",
        CAPTION_CLASS,
        element.type === "logo" ? "aspect-[3/1]" : "aspect-[4/3]",
      )}
      style={{
        borderColor: ticketRgba(theme.accent, 0.45),
        backgroundColor: ticketRgba(theme.accent, 0.05),
        color: theme.muted,
      }}
    >
      {element.label || (element.type === "logo" ? "Logo" : "Image")}
    </span>
  );
}

function TicketLayer({
  element,
  interactive,
  onPointerDown,
  qrValue,
  resolve,
  scanLabel,
  selected,
  theme,
  ticketNumber,
}: {
  element: TicketCanvasElement;
  interactive: boolean;
  onPointerDown?: (
    event: ReactPointerEvent<HTMLDivElement>,
    element: TicketCanvasElement,
  ) => void;
  qrValue: string;
  resolve: TicketElementResolver;
  scanLabel: string;
  selected: boolean;
  theme: TicketTheme;
  ticketNumber: string;
}) {
  const resolved = resolve(element);
  const style = element.style || {};
  const isMedia = element.type === "logo" || element.type === "image";
  const multiLine =
    element.type === "terms" ||
    element.type === "custom_text" ||
    element.type === "address" ||
    // The hero title is the one field allowed to wrap: a long event name
    // should break onto a second line rather than lose its ending.
    element.type === "event_name";
  const mutedByDefault =
    element.type === "terms" ||
    element.type === "ticket_number" ||
    element.type === "address";
  const Icon = style.showIcon ? ELEMENT_ICONS[element.type] : undefined;

  const block: CSSProperties = {
    left: `${element.x}%`,
    top: `${element.y}%`,
    width: `${element.width}%`,
    textAlign: element.align,
    paddingTop: style.paddingTop,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    marginTop: style.marginTop,
    marginRight: style.marginRight,
    marginBottom: style.marginBottom,
    marginLeft: style.marginLeft,
    backgroundColor: style.backgroundColor
      ? ticketRgba(style.backgroundColor, (style.backgroundOpacity ?? 100) / 100)
      : undefined,
    borderRadius: style.borderRadius,
    border: style.borderWidth
      ? `${style.borderWidth}px solid ${style.borderColor || theme.accent}`
      : undefined,
    opacity: style.opacity != null ? style.opacity / 100 : undefined,
    transform: style.rotation ? `rotate(${style.rotation}deg)` : undefined,
  };

  const typography: CSSProperties = {
    fontFamily: ticketFontStack(style.fontFamily),
    fontSize:
      style.fontScale && style.fontScale !== 100
        ? `calc(${baseFontSize(element.size)} * ${style.fontScale / 100})`
        : undefined,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    letterSpacing:
      style.letterSpacing != null ? `${style.letterSpacing / 100}em` : undefined,
    lineHeight: style.lineHeight != null ? style.lineHeight / 100 : undefined,
    textTransform: style.textTransform,
    color: style.textColor || (mutedByDefault ? theme.muted : undefined),
  };

  let content: ReactNode;
  if (element.type === "panel") {
    // Panels are sized in ticket-height percent, converted to container units
    // so the block keeps its proportion at any canvas size.
    content = (
      <span
        className="block w-full"
        style={{ height: `${((style.height ?? 20) / TICKET_ASPECT)}cqw` }}
      />
    );
  } else if (element.type === "divider") {
    content = (
      <span
        className="block w-full"
        style={{
          height: style.borderWidth || 2,
          backgroundColor: style.textColor || theme.accent,
          borderRadius: 999,
        }}
      />
    );
  } else if (element.type === "qr") {
    content = (
      <TicketQrBlock
        editable={interactive}
        element={element}
        qrValue={qrValue}
        scanLabel={scanLabel}
        theme={theme}
        ticketNumber={ticketNumber}
      />
    );
  } else if (element.type === "barcode") {
    content = (
      <span className="block w-full">
        <span
          className="block w-full"
          style={{ height: `${((style.height ?? 26) / TICKET_ASPECT)}cqw` }}
        >
          <TicketBarcode
            color={style.textColor || theme.text}
            value={ticketNumber}
          />
        </span>
        {!style.hideCaption && (
          <span
            className="mt-[0.5em] block w-full truncate text-center font-mono text-[min(1.05cqw,11px)] font-semibold"
            style={{ color: style.textColor || theme.text }}
          >
            {ticketNumber}
          </span>
        )}
      </span>
    );
  } else if (isMedia) {
    content = element.value ? (
      <img
        src={element.value}
        alt=""
        draggable={false}
        className={cn(
          "w-full",
          element.type === "logo"
            ? "object-contain object-left"
            : "aspect-[4/3] object-cover",
        )}
        style={{
          maxHeight: element.type === "logo" ? "12cqw" : undefined,
          borderRadius: style.borderRadius ?? 6,
        }}
      />
    ) : (
      <TicketMediaPlaceholder element={element} theme={theme} />
    );
  } else {
    content = (
      <>
        {resolved.caption && !style.hideCaption && (
          <span
            className={cn(
              "mb-[0.45em] block truncate uppercase",
              CAPTION_CLASS,
            )}
            style={{
              color: style.captionColor || theme.muted,
              fontFamily: ticketFontStack(style.fontFamily),
            }}
          >
            {resolved.caption}
          </span>
        )}
        <span
          className={cn(
            "flex w-full items-center gap-[0.55em]",
            element.align === "center" && "justify-center",
            element.align === "right" && "justify-end",
          )}
        >
          {Icon && (
            <Icon
              className="h-[1.05em] w-[1.05em] shrink-0"
              style={{
                color: style.captionColor || theme.accent,
                fontSize: typography.fontSize || baseFontSize(element.size),
              }}
            />
          )}
          <span
            className={cn(
              "block min-w-0",
              textClassFor(element.size),
              element.size === "small" ? "font-medium" : "font-semibold",
              multiLine ? "whitespace-pre-line" : "truncate",
            )}
            style={typography}
          >
            {resolved.text}
          </span>
        </span>
        {element.type === "event_name" && !style.hideCaption && (
          <span
            className="mt-[0.45em] block h-[3px] rounded-full"
            style={{
              backgroundColor: style.captionColor || theme.accent,
              width: "22%",
              marginLeft:
                element.align === "center" || element.align === "right"
                  ? "auto"
                  : undefined,
              marginRight: element.align === "center" ? "auto" : undefined,
            }}
          />
        )}
      </>
    );
  }

  return (
    <div
      data-ticket-element={element.id}
      onPointerDown={
        interactive ? (event) => onPointerDown?.(event, element) : undefined
      }
      className={cn(
        "absolute",
        interactive && "cursor-grab touch-none active:cursor-grabbing",
        interactive &&
          !selected &&
          "rounded-[3px] ring-1 ring-transparent hover:ring-primary/40",
      )}
      style={block}
    >
      {content}
    </div>
  );
}

/**
 * The one place a ticket is drawn. Template previews, the design canvas, and
 * gallery thumbnails all render through this so a template looks identical
 * everywhere. Typography is sized in container units, so the same layout is
 * faithful at thumbnail size and at full canvas size.
 */
export function TicketSurface({
  className,
  elements,
  flat = false,
  interactive = false,
  onDragOver,
  onDrop,
  onElementPointerDown,
  onSurfacePointerDown,
  overlay,
  qrValue,
  resolve,
  scanLabel = "Scan at entry",
  selectedId,
  side,
  surfaceRef,
  theme,
  ticketNumber,
}: {
  className?: string;
  elements: TicketCanvasElement[];
  /** Drops the card border, radius, and shadow for embedded thumbnails. */
  flat?: boolean;
  /** Enables selection affordances and pointer dragging in the designer. */
  interactive?: boolean;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onElementPointerDown?: (
    event: ReactPointerEvent<HTMLDivElement>,
    element: TicketCanvasElement,
  ) => void;
  onSurfacePointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Guides, handles, and rulers drawn above the ticket by the designer. */
  overlay?: ReactNode;
  qrValue: string;
  resolve: TicketElementResolver;
  scanLabel?: string;
  selectedId?: string;
  side: "front" | "back";
  surfaceRef?: RefObject<HTMLDivElement>;
  theme: TicketTheme;
  ticketNumber: string;
}) {
  const motif = ticketMotifStyle(theme);
  const dark = ticketLuminance(theme.background) < 0.45;
  const perforated = theme.edge === "perforated";
  const doubleEdge = theme.edge === "double";
  return (
    <div
      ref={surfaceRef}
      data-ticket-canvas={side}
      data-ticket-template-canvas={side}
      className={cn(
        // Type is sized in container units so one layout is faithful at
        // thumbnail size and at full canvas size.
        "relative aspect-[2.6/1] w-full select-none overflow-hidden [container-type:inline-size]",
        flat
          ? "rounded-none"
          : "rounded-2xl shadow-[0_18px_45px_-18px_rgba(15,23,42,0.45)]",
        interactive && "outline-none",
        className,
      )}
      style={{
        backgroundColor: theme.background,
        color: theme.text,
        border: flat
          ? undefined
          : `1px solid ${ticketRgba(theme.accent, dark ? 0.5 : 0.35)}`,
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPointerDown={onSurfacePointerDown}
    >
      {theme.backgroundImage && (
        <>
          <img
            src={theme.backgroundImage}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `linear-gradient(100deg, ${ticketRgba(
                theme.background,
                0.94,
              )} 0%, ${ticketRgba(theme.background, 0.82)} 46%, ${ticketRgba(
                theme.background,
                0.5,
              )} 100%)`,
            }}
          />
        </>
      )}

      {motif && (
        <div className="pointer-events-none absolute inset-0" style={motif} />
      )}

      {/* Accent light, kept soft so type stays readable. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(46% 92% at 74% 0%, ${ticketRgba(
            theme.accent,
            dark ? 0.2 : 0.09,
          )} 0%, transparent 72%), radial-gradient(38% 70% at 0% 100%, ${ticketRgba(
            theme.accent,
            dark ? 0.12 : 0.05,
          )} 0%, transparent 74%)`,
        }}
      />

      {doubleEdge && (
        <div
          className="pointer-events-none absolute inset-[1.4%] rounded-xl border"
          style={{ borderColor: ticketRgba(theme.accent, 0.4) }}
        />
      )}

      {elements.map((element) => (
        <TicketLayer
          key={element.id}
          element={element}
          interactive={interactive}
          onPointerDown={onElementPointerDown}
          qrValue={qrValue}
          resolve={resolve}
          scanLabel={scanLabel}
          selected={selectedId === element.id}
          theme={theme}
          ticketNumber={ticketNumber}
        />
      ))}

      {/* Drawn above the layers so a panel behind the stub cannot cover it. */}
      {perforated && (
        <>
          <div
            data-ticket-perforation="line"
            className="pointer-events-none absolute inset-y-0 flex flex-col items-center justify-between py-[2%]"
            style={{ left: `${TICKET_STUB_X}%`, transform: "translateX(-50%)" }}
          >
            {Array.from({ length: 12 }).map((_, index) => (
              <span
                key={index}
                className="block h-[3.6%] w-[0.42cqw] rounded-full"
                style={{ backgroundColor: ticketRgba(theme.accent, 0.6) }}
              />
            ))}
          </div>
          {[{ top: "-1.9%" }, { bottom: "-1.9%" }].map((position, index) => (
            <span
              key={index}
              data-ticket-perforation="notch"
              className="pointer-events-none absolute h-[7%] w-[1.9cqw] rounded-full"
              style={{
                ...position,
                left: `${TICKET_STUB_X}%`,
                transform: "translateX(-50%)",
                backgroundColor: "hsl(var(--background))",
                boxShadow: `0 0 0 1px ${ticketRgba(theme.accent, 0.3)}`,
              }}
            />
          ))}
        </>
      )}

      {overlay}
    </div>
  );
}

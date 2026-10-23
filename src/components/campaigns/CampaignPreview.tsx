/**
 * Renders a campaign design as it will look in an inbox.
 *
 * The same component backs three surfaces, so a template card, the builder
 * canvas, and the desktop/mobile preview never drift apart: the gallery renders
 * it scaled down as a real thumbnail, the canvas renders it selectable, and the
 * preview pane renders it at the chosen width.
 */
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { cn } from "@/lib/utils";
import { VariableText } from "@/components/ui/variable-text";

import {
  campaignBlockTextStyle,
  campaignColor,
  campaignContainerStyle,
  campaignElementFill,
  campaignElementStyle,
  campaignImageSource,
  campaignBlockLabels,
  campaignLink,
  countdownImageUrl,
  countdownRemaining,
  resolveCampaignVideo,
  socialNetworkLabels,
  type CampaignBlock,
  type CampaignBreakpoint,
  type CampaignDesign,
} from "./campaign-blocks";

const textAlign = (block: CampaignBlock) =>
  block.align === "center" ? "center" : "left";

function CountdownPreview({
  block,
  accent,
}: {
  block: CampaignBlock;
  accent: string;
}) {
  const remaining = countdownRemaining(block.deadline);
  const cells = remaining
    ? [
        { value: remaining.days, label: "Days" },
        { value: remaining.hours, label: "Hours" },
        { value: remaining.minutes, label: "Mins" },
      ]
    : [];
  return (
    <div className="mb-6 text-center">
      {block.content ? (
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-slate-500">
          {block.content}
        </p>
      ) : null}
      {remaining && !remaining.past ? (
        <div className="flex items-end justify-center gap-4">
          {cells.map((cell) => (
            <div key={cell.label}>
              <div
                className="flex h-[52px] w-[74px] items-center justify-center rounded-md text-[26px] font-bold tabular-nums text-white"
                style={{ backgroundColor: accent }}
              >
                {String(cell.value).padStart(2, "0")}
              </div>
              <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-[.08em] text-slate-500">
                {cell.label}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-slate-400">
          {remaining ? "This deadline has passed." : "Set a deadline to render the timer."}
        </p>
      )}
      <p className="mt-3 text-[9px] leading-4 text-slate-400">
        In the sent email this is an image the server draws when the message is
        opened. It shows the time left at that moment and does not tick.
      </p>
    </div>
  );
}

function ProductGridPreview({ block }: { block: CampaignBlock }) {
  const items = (block.items || []).filter((item) => item.title);
  const columns = Math.min(3, Math.max(1, block.columns || 2));
  if (!items.length) {
    return (
      <div className="mb-6 rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-[11px] leading-5 text-slate-500">
        {block.sourceType === "tickets"
          ? "Choose an event's ticket types in the block settings."
          : "Choose products from your catalog in the block settings."}
      </div>
    );
  }
  return (
    <div
      className="mb-5 grid gap-4"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.id}>
          {campaignImageSource(item.imageSrc) ? (
            <img
              src={item.imageSrc}
              alt={item.title}
              className="mb-2.5 aspect-4/3 w-full rounded-[10px] object-cover"
            />
          ) : (
            <div className="mb-2.5 aspect-4/3 w-full rounded-[10px] bg-slate-100" />
          )}
          <p className="text-[14px] font-semibold leading-tight text-slate-900">
            {item.title}
          </p>
          <p className="mt-1 text-[13px] text-slate-500">{item.price}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * One block, with no email shell around it. The builder canvas renders blocks
 * through this so a single block does not appear wrapped in its own complete
 * email, while the full preview composes them inside the shell.
 */
/**
 * Renders a block with its Design-tab overrides applied.
 *
 * The inner renderer owns each type's default look; this wrapper layers the
 * user's typography, colour, spacing and border on top, so an untouched block
 * still renders from the campaign palette rather than being pinned to it.
 */
/**
 * Text that can be typed into where it sits.
 *
 * The element keeps whatever styling the block gave it and simply becomes
 * writable, so editing happens in the finished design rather than in a
 * separate field that only approximates it.
 */
export function EditableText({
  as: Tag = "span",
  value,
  onChange,
  label,
  multiline = false,
  className,
  style,
}: {
  as?: "span" | "p" | "h1" | "h2" | "div" | "blockquote";
  value: string;
  onChange?: (value: string) => void;
  label?: string;
  multiline?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const committed = useRef(value);

  // Only rewrite the node when the value changed elsewhere. Writing on every
  // render would drop the caret to the start on each keystroke.
  useEffect(() => {
    const node = ref.current;
    if (!node || !onChange) return;
    if (node.textContent === value) return;
    node.textContent = value;
    committed.current = value;
  }, [onChange, value]);

  // Not the block being edited, so the copy is presentation: merge variables
  // render as readable tokens instead of raw `{{event.name}}` syntax. The block
  // you are actually typing in keeps its braces below, because that is the text
  // being edited — swapping it for tokens mid-keystroke would fight the caret.
  if (!onChange) {
    return (
      <Tag className={className} style={style}>
        <VariableText value={value} />
      </Tag>
    );
  }

  const commit = () => {
    const next = ref.current?.textContent ?? "";
    if (next === committed.current) return;
    committed.current = next;
    onChange(next);
  };

  return (
    <Tag
      ref={ref as never}
      role="textbox"
      aria-label={label}
      aria-multiline={multiline}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onInput={commit}
      onBlur={commit}
      onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
        // Enter commits on a single-line block; only prose accepts a break.
        if (event.key === "Enter" && !multiline) {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        event.stopPropagation();
      }}
      onClick={(event: ReactMouseEvent<HTMLElement>) =>
        event.stopPropagation()
      }
      className={cn(
        "outline-hidden focus:ring-1 focus:ring-primary/40 focus:ring-offset-1",
        className,
      )}
      style={style}
    >
      {value}
    </Tag>
  );
}

export function CampaignBlockBody({
  block,
  accent,
  editable,
  breakpoint = "desktop",
}: {
  block: CampaignBlock;
  accent: string;
  /** Present when this block's copy is being edited on the canvas. */
  editable?: (content: string) => void;
  /** Which screen's values to render; narrower ones inherit from desktop. */
  breakpoint?: CampaignBreakpoint;
}) {
  // Box styles go on the wrapper; typography is handed to the renderer so it
  // lands on the text element itself, where it beats the renderer's own
  // classes instead of being ignored as an inherited value.
  const boxStyle = campaignContainerStyle(block, breakpoint);
  const advanced = block.advanced || {};
  const inner = (
    <CampaignBlockContent
      block={block}
      accent={accent}
      editable={editable}
      breakpoint={breakpoint}
    />
  );
  // The wrapper always renders, and always carries the block's own id. Scoping
  // by instance is what keeps one block's custom class or CSS from reaching
  // into another's markup.
  return (
    <div
      id={advanced.htmlId || undefined}
      data-block-id={block.id}
      data-block-type={block.type}
      className={cn("mf-block", advanced.cssClass)}
      style={boxStyle}
    >
      {inner}
    </div>
  );
}

function CampaignBlockContent({
  block,
  accent: campaignAccent,
  editable,
  breakpoint = "desktop",
}: {
  block: CampaignBlock;
  accent: string;
  editable?: (content: string) => void;
  breakpoint?: CampaignBreakpoint;
}) {
  const align = textAlign(block);
  // A block's own text colour overrides the campaign accent wherever the block
  // paints text with it — the eyebrow, the coupon code, the stat figures.
  const accent = block.design?.textColor || campaignAccent;
  // The fill of the element itself, kept separate from the block's background
  // band so colouring a button paints the button, not the strip behind it.
  const fill = campaignElementFill(block, campaignAccent);
  const editLabel = editable
    ? `Edit ${campaignBlockLabels[block.type]} text`
    : undefined;
  // Applied inline on whichever element carries the copy, so the Design tab
  // overrides the renderer's own defaults rather than losing to them.
  //
  // `text` is typography only, for blocks whose element IS the text. `element`
  // adds border, radius, size and inner padding, for blocks with a distinct
  // thing inside — a button, an image, a coupon chip. Neither ever reaches the
  // wrapper, which is what keeps a button's border on the button.
  const text = campaignBlockTextStyle(block, breakpoint);
  const element = campaignElementStyle(block, breakpoint);
  if (block.type === "label") {
    return (
      <EditableText
        as="p"
        value={block.content || (editable ? "" : "Eyebrow label")}
        onChange={editable}
        label={editLabel}
        className="mb-3.5 text-[11px] font-bold uppercase tracking-[.11em]"
        style={{ color: accent, textAlign: align, ...text }}
      />
    );
  }
  if (block.type === "heading") {
    const size =
      block.size === "small"
        ? "text-[22px]"
        : block.size === "medium"
          ? "text-[28px]"
          : "text-[32px]";
    return (
      <EditableText
        as="h1"
        value={block.content || (editable ? "" : "Heading")}
        onChange={editable}
        label={editLabel}
        className={cn("mb-4 font-bold leading-[1.22] text-slate-900", size)}
        style={{ textAlign: align, ...text }}
      />
    );
  }
  if (block.type === "text") {
    return (
      <EditableText
        as="p"
        multiline
        value={block.content || (editable ? "" : "Paragraph text")}
        onChange={editable}
        label={editLabel}
        className="mb-5 whitespace-pre-line text-[15px] leading-[1.65] text-slate-600"
        style={{ textAlign: align, ...text }}
      />
    );
  }
  if (block.type === "button") {
    return (
      <div className="mb-6" style={{ textAlign: align, ...text }}>
        <EditableText
          value={block.content || (editable ? "" : "Button")}
          onChange={editable}
          label={editLabel}
          className="inline-block rounded-[9px] px-5 py-3 text-[14px] font-bold text-white"
          style={{ backgroundColor: fill, ...element }}
        />
        {!campaignLink(block.href) ? (
          <p className="mt-2 text-[10px] text-rose-500">
            Add an https link or this button is dropped from the send.
          </p>
        ) : null}
      </div>
    );
  }
  if (block.type === "image") {
    const src = campaignImageSource(block.src);
    return (
      <div className="mb-6" style={{ textAlign: align, ...text }}>
        {src ? (
          <img
            src={src}
            alt={block.alt || ""}
            className="inline-block max-w-full rounded-xl"
            style={element}
          />
        ) : (
          <div className="flex h-32 items-center justify-center rounded-xl bg-slate-100 text-[11px] text-slate-400">
            Upload an image in the block settings
          </div>
        )}
      </div>
    );
  }
  if (block.type === "divider") {
    return (
      <div
        className="mb-6 mt-1 bg-slate-200"
        style={{
          height: block.design?.borderWidth || 1,
          backgroundColor: block.design?.borderColor || undefined,
          ...(block.design?.width ? { width: block.design.width } : {}),
        }}
      />
    );
  }
  if (block.type === "spacer") {
    return (
      <div
        style={{ height: Math.min(120, Math.max(8, block.height || 24)) }}
        className="rounded bg-slate-50"
      />
    );
  }
  if (block.type === "hero") {
    const src = campaignImageSource(block.src);
    const overlay = Math.min(80, Math.max(0, block.overlay ?? 45)) / 100;
    return (
      <div
        className="mb-6 overflow-hidden rounded-[14px] bg-cover bg-center"
        style={{
          backgroundColor: accent,
          backgroundImage: src ? `url(${src})` : undefined,
        }}
      >
        <div
          className="px-7 py-11 text-center"
          style={{ backgroundColor: `rgba(9,14,28,${overlay})` }}
        >
          <h1 className="text-[28px] font-bold leading-[1.24] text-white">
            {block.content || "Hero heading"}
          </h1>
          {block.subtext ? (
            <p className="mt-3 text-[15px] leading-[1.6] text-slate-100">
              {block.subtext}
            </p>
          ) : null}
          {campaignLink(block.href) ? (
            <span
              className="mt-5 inline-block rounded-[9px] bg-white px-5 py-3 text-[14px] font-bold"
              style={{ color: accent }}
            >
              {block.buttonLabel || "View details"}
            </span>
          ) : null}
        </div>
      </div>
    );
  }
  if (block.type === "product_grid") return <ProductGridPreview block={block} />;
  if (block.type === "countdown") {
    return <CountdownPreview block={block} accent={accent} />;
  }
  if (block.type === "social") {
    const links = (block.socials || []).filter((item) =>
      campaignLink(item.href),
    );
    return (
      <div className="mb-6 text-center">
        {links.length ? (
          links.map((item) => (
            <span
              key={item.id}
              className="mx-1.5 inline-block text-[13px] font-semibold"
              style={{ color: accent }}
            >
              {socialNetworkLabels[item.network]}
            </span>
          ))
        ) : (
          <p className="text-[11px] text-slate-400">
            Add at least one https profile link.
          </p>
        )}
      </div>
    );
  }
  if (block.type === "testimonial") {
    return (
      <div
        className="mb-6 border-l-[3px] pl-4"
        style={{ borderColor: accent }}
      >
        <EditableText
          as="p"
          multiline
          value={block.content || (editable ? "" : "A quote from a customer")}
          onChange={editable}
          label={editLabel}
          className="text-[16px] italic leading-[1.6] text-slate-900"
        />
        {block.attribution ? (
          <p className="mt-2.5 text-[12px] text-slate-400">
            {block.attribution}
          </p>
        ) : null}
      </div>
    );
  }
  if (block.type === "list") {
    const items = block.listItems?.length
      ? block.listItems
      : ["Your first point"];
    return (
      <ul className="mb-4 space-y-1.5" style={{ textAlign: align, ...text }}>
        {items.map((item, index) => (
          <li
            key={index}
            className="flex gap-2 text-[15px] leading-[1.65] text-slate-700"
          >
            <span
              className="shrink-0 font-semibold"
              style={{ color: block.listStyle === "check" ? accent : undefined }}
            >
              {block.listStyle === "number"
                ? `${index + 1}.`
                : block.listStyle === "check"
                  ? "✓"
                  : "•"}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "quote") {
    return (
      <blockquote
        className="mb-4 border-l-[3px] pl-4"
        style={{ borderColor: accent, textAlign: align }}
      >
        <EditableText
          as="p"
          multiline
          value={block.content || (editable ? "" : "A line worth pulling out")}
          onChange={editable}
          label={editLabel}
          className="text-[17px] font-medium italic leading-[1.55] text-slate-900"
        />
      </blockquote>
    );
  }
  if (block.type === "button_group") {
    return (
      <div
        className="mb-4 flex flex-wrap gap-2"
        style={{ justifyContent: align === "center" ? "center" : "flex-start" }}
      >
        {(block.entries || []).map((entry) => (
          <span
            key={entry.id}
            className="inline-block rounded-md px-5 py-2.5 text-[14px] font-semibold text-white"
            style={{ backgroundColor: fill, ...element }}
          >
            {entry.label || "Button"}
          </span>
        ))}
      </div>
    );
  }
  if (block.type === "image_gallery") {
    const images = (block.items || []).filter((item) => item.imageSrc);
    return (
      <div
        className="mb-4 grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, images.length || 3))}, minmax(0, 1fr))`,
        }}
      >
        {(images.length ? images : [null, null, null]).map((item, index) =>
          item ? (
            <img
              key={item.id}
              src={item.imageSrc}
              alt=""
              className="h-24 w-full rounded object-cover"
            />
          ) : (
            <div
              key={index}
              className="flex h-24 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400"
            >
              Image
            </div>
          ),
        )}
      </div>
    );
  }
  if (block.type === "video") {
    // The builder plays the real thing so the choice can be checked. The sent
    // email cannot — no inbox runs an iframe — so the export falls back to a
    // poster that links out.
    const video = resolveCampaignVideo(block.href);
    const poster =
      campaignImageSource(block.posterSrc) ||
      (video?.provider === "youtube" ? video.thumbnail : "");
    return (
      <div className="mb-4" style={{ textAlign: align, ...text }}>
        <div
          className="relative overflow-hidden rounded-lg bg-slate-900"
          style={{ borderRadius: block.design?.borderRadius }}
        >
          {video?.provider === "youtube" || video?.provider === "vimeo" ? (
            <iframe
              src={video.embedUrl}
              title={block.content || "Campaign video"}
              allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              className="aspect-video w-full border-0"
            />
          ) : video?.provider === "file" ? (
            <video
              src={video.embedUrl}
              poster={poster || undefined}
              controls
              className="aspect-video w-full bg-black"
            />
          ) : (
            <>
              {poster ? (
                <img
                  src={poster}
                  alt=""
                  className="h-44 w-full object-cover opacity-80"
                />
              ) : (
                <div className="flex h-44 w-full items-center justify-center px-4 text-center text-[11px] text-slate-400">
                  Paste a YouTube, Vimeo or MP4 link in the Details tab
                </div>
              )}
              <span className="absolute inset-0 flex items-center justify-center">
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full text-[18px] text-white"
                  style={{ backgroundColor: fill }}
                >
                  &#9654;
                </span>
              </span>
            </>
          )}
        </div>
        {block.content ? (
          <p
            className="mt-2 text-[13px]"
            style={{ color: block.design?.textColor || "#64748B" }}
          >
            {block.content}
          </p>
        ) : null}
      </div>
    );
  }
  if (block.type === "logo") {
    return (
      <div className="mb-4" style={{ textAlign: align, ...text }}>
        {block.src ? (
          <img
            src={block.src}
            alt={block.alt || "Logo"}
            style={{ height: block.height || 40 }}
            className="inline-block object-contain"
          />
        ) : (
          <span className="inline-block rounded bg-slate-100 px-4 py-2 text-[11px] text-slate-400">
            Your logo
          </span>
        )}
      </div>
    );
  }
  if (block.type === "columns") {
    const entries = block.entries?.length
      ? block.entries
      : [
          { id: "a", label: "First", value: "" },
          { id: "b", label: "Second", value: "" },
        ];
    return (
      <div
        className="mb-4 grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${Math.min(3, entries.length)}, minmax(0, 1fr))`,
        }}
      >
        {entries.map((entry) => (
          <div key={entry.id}>
            <p className="mb-1 text-[14px] font-semibold text-slate-900">
              <VariableText value={entry.label} />
            </p>
            <p className="text-[13px] leading-[1.6] text-slate-600">
              <VariableText value={entry.value} />
            </p>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "coupon") {
    return (
      <div className="mb-4" style={{ textAlign: align, ...text }}>
        {block.content ? (
          <p className="mb-2 text-[13px] text-slate-500">{block.content}</p>
        ) : null}
        <span
          className="inline-block rounded-lg border-2 border-dashed px-6 py-3 text-[20px] font-bold tracking-[.12em]"
          style={{ borderColor: accent, color: accent, ...element }}
        >
          {block.couponCode || "CODE"}
        </span>
        {block.subtext ? (
          <p className="mt-2 text-[11px] text-slate-400">{block.subtext}</p>
        ) : null}
      </div>
    );
  }
  if (block.type === "order_summary") {
    const entries = block.entries || [];
    return (
      <div className="mb-4 rounded-lg border border-slate-200">
        {block.content ? (
          <p className="border-b border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-slate-900">
            {block.content}
          </p>
        ) : null}
        {entries.map((entry, index) => (
          <div
            key={entry.id}
            className={`flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] ${
              index === entries.length - 1
                ? "border-t border-slate-200 font-semibold text-slate-900"
                : "text-slate-600"
            }`}
          >
            <span><VariableText value={entry.label} /></span>
            <span><VariableText value={entry.value} /></span>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "menu") {
    return (
      <div
        className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5"
        style={{ justifyContent: align === "center" ? "center" : "flex-start" }}
      >
        {(block.entries || []).map((entry) => (
          <span
            key={entry.id}
            className="text-[13px] font-medium"
            style={{ color: accent }}
          >
            <VariableText value={entry.label} />
          </span>
        ))}
      </div>
    );
  }
  if (block.type === "stats") {
    const entries = block.entries || [];
    return (
      <div
        className="mb-4 grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, entries.length))}, minmax(0, 1fr))`,
        }}
      >
        {entries.map((entry) => (
          <div key={entry.id} className="text-center">
            <p
              className="text-[24px] font-bold leading-tight"
              style={{ color: accent }}
            >
              <VariableText value={entry.value} />
            </p>
            <p className="mt-0.5 text-[11px] uppercase tracking-[.08em] text-slate-400">
              <VariableText value={entry.label} />
            </p>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "feature_list") {
    return (
      <div className="mb-4 space-y-3">
        {(block.entries || []).map((entry) => (
          <div key={entry.id} className="flex gap-3">
            <span
              className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ backgroundColor: fill }}
            >
              ✓
            </span>
            <span>
              <span className="block text-[14px] font-semibold text-slate-900">
                <VariableText value={entry.label} />
              </span>
              <span className="block text-[13px] leading-[1.6] text-slate-600">
                <VariableText value={entry.value} />
              </span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "cta_banner") {
    return (
      <div
        className="mb-4 rounded-lg px-6 py-6 text-center"
        style={{ backgroundColor: fill, ...element }}
      >
        <p className="text-[19px] font-bold text-white">
          {block.content || "Ready when you are"}
        </p>
        {block.subtext ? (
          <p className="mt-1.5 text-[13px] text-white/85">{block.subtext}</p>
        ) : null}
        <span className="mt-4 inline-block rounded-md bg-white px-5 py-2.5 text-[14px] font-semibold">
          {block.buttonLabel || "Get started"}
        </span>
      </div>
    );
  }
  if (block.type === "rating") {
    const stars = Math.max(0, Math.min(5, block.rating ?? 5));
    return (
      <div className="mb-4" style={{ textAlign: align, ...text }}>
        <p className="text-[20px] tracking-[.15em]" style={{ color: accent }}>
          {"★".repeat(stars)}
          <span className="text-slate-200">{"★".repeat(5 - stars)}</span>
        </p>
        {block.content ? (
          <p className="mt-1 text-[12px] text-slate-500">{block.content}</p>
        ) : null}
      </div>
    );
  }
  if (block.type === "event_details") {
    const starts = block.eventStartsAt ? new Date(block.eventStartsAt) : null;
    return (
      <div className="mb-4 rounded-lg border border-slate-200 px-4 py-3.5">
        {block.content ? (
          <p className="mb-2 text-[13px] font-semibold text-slate-900">
            {block.content}
          </p>
        ) : null}
        {starts && !Number.isNaN(starts.getTime()) ? (
          <p className="text-[13px] text-slate-600">
            {starts.toLocaleString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        ) : null}
        {block.eventLocation ? (
          <p className="mt-1 text-[13px] text-slate-600">
            {block.eventLocation}
          </p>
        ) : null}
      </div>
    );
  }
  if (block.type === "form") {
    // Inboxes strip <form>, so this renders the fields as a prompt and lets the
    // button do the real work by linking to the hosted form.
    return (
      <div className="mb-4" style={{ textAlign: align, ...text }}>
        {block.content ? (
          <p className="mb-1 text-[15px] font-semibold text-slate-900">
            {block.content}
          </p>
        ) : null}
        {block.subtext ? (
          <p className="mb-3 text-[12.5px] text-slate-500">{block.subtext}</p>
        ) : null}
        <div className="space-y-2">
          {(block.entries || []).map((entry) => (
            <div key={entry.id}>
              <p className="mb-1 text-[11px] font-medium text-slate-600">
                <VariableText value={entry.label} />
              </p>
              <div
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-400"
                style={element}
              >
                <VariableText value={entry.value || "…"} />
              </div>
            </div>
          ))}
        </div>
        <span
          className="mt-3 inline-block rounded-md px-5 py-2.5 text-[14px] font-semibold text-white"
          style={{ backgroundColor: fill }}
        >
          {block.buttonLabel || "Subscribe"}
        </span>
        {!campaignLink(block.href) ? (
          <p className="mt-2 text-[10px] text-rose-500">
            Add the https link to your hosted form, or this button is dropped.
          </p>
        ) : null}
      </div>
    );
  }
  if (block.type === "html") {
    // Author-supplied markup for their own campaign. Scripts are stripped
    // because no inbox executes them and shipping one is pure risk.
    const safe = String(block.html || "").replace(
      /<script[\s\S]*?<\/script>/gi,
      "",
    );
    return (
      <div
        className="mb-4 text-[15px] leading-[1.65] text-slate-700"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    );
  }
  const address = String(block.mailingAddress || "").trim();
  return (
    <div className="mt-2 border-t border-slate-200 pt-4 text-center">
      <p className="text-[11px] leading-[1.6] text-slate-400 underline">
        {block.unsubscribeLabel || "Unsubscribe"}
      </p>
      {address ? (
        <p className="mt-2 whitespace-pre-line text-[11px] leading-[1.6] text-slate-400">
          {address}
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-[1.6] text-rose-500">
          A physical mailing address is required before this campaign can send.
        </p>
      )}
    </div>
  );
}

export function CampaignPreview({
  design,
  interactive = false,
  onSelect,
  selectedBlockId,
  width = 600,
  breakpoint = "desktop",
}: {
  design: CampaignDesign;
  interactive?: boolean;
  onSelect?: (blockId: string) => void;
  selectedBlockId?: string | null;
  width?: number;
  /** The responsive values to use inside the rendered email. */
  breakpoint?: CampaignBreakpoint;
}) {
  const accent = campaignColor(design.accent, "#635BFF");
  const container = design.container || {};
  return (
    <div
      className="w-full p-5 sm:p-7"
      style={{
        backgroundColor: campaignColor(design.pageBackground, "#F5F7FB"),
      }}
    >
      <div
        className="mx-auto w-full overflow-hidden shadow-[0_16px_42px_rgba(15,23,42,.13)]"
        style={{
          backgroundColor: campaignColor(design.cardBackground, "#FFFFFF"),
          maxWidth: container.width || width,
          borderRadius: container.cornerRadius ?? 12,
          fontFamily: container.fontFamily || undefined,
        }}
      >
        {container.stripeHeight !== 0 ? (
          <div
            style={{
              height: container.stripeHeight ?? 6,
              backgroundColor: campaignColor(container.stripeColor, accent),
            }}
          />
        ) : null}
        {container.headerTitle || container.headerIcon ? (
          <div
            className="flex items-center gap-2.5 px-6 py-3.5"
            style={{
              backgroundColor: campaignColor(
                container.headerBackground,
                campaignColor(design.cardBackground, "#FFFFFF"),
              ),
              color: campaignColor(container.headerTextColor, "#172033"),
            }}
          >
            {container.headerIcon ? (
              <span className="text-[18px] leading-none">
                {container.headerIcon}
              </span>
            ) : null}
            {container.headerTitle ? (
              <span className="truncate text-[15px] font-semibold">
                {container.headerTitle}
              </span>
            ) : null}
          </div>
        ) : null}
        <div
          className="space-y-1"
          style={{ padding: container.contentPadding ?? 28 }}
        >
          {design.blocks.length ? (
            design.blocks.map((block) => {
              const body = (
                <CampaignBlockBody
                  accent={accent}
                  block={block}
                  breakpoint={breakpoint}
                />
              );
              if (!interactive) return <Fragment key={block.id}>{body}</Fragment>;
              return (
                <div
                  key={block.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${block.type.replace(/_/g, " ")} block`}
                  aria-pressed={selectedBlockId === block.id}
                  onClick={() => onSelect?.(block.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect?.(block.id);
                    }
                  }}
                  className={cn(
                    "cursor-pointer rounded-md p-1 outline-hidden transition-shadow",
                    selectedBlockId === block.id
                      ? "shadow-[0_0_0_2px_rgb(99,91,255)]"
                      : "hover:shadow-[0_0_0_1px_rgb(148,163,184)]",
                  )}
                >
                  {body}
                </div>
              );
            })
          ) : (
            <p className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-slate-300 text-[12px] text-slate-500">
              Add a block from the palette to start building.
            </p>
          )}
        </div>
        <div className="px-7 pb-7">
          <p className="border-t border-slate-100 pt-4 text-[10px] leading-4 text-slate-400">
            <VariableText value={design.footerText || "Sent by {{workspace.name}}"} />
          </p>
        </div>
      </div>
    </div>
  );
}

/** Natural width of the preview at full size: a 600 px card plus its padding. */
const THUMBNAIL_REFERENCE_WIDTH = 656;

/**
 * A real render of the design, scaled to fit a gallery card. Nothing about the
 * card is a stand-in image: it is the same markup the inbox preview uses, only
 * smaller. The scale is measured rather than fixed, because a card's width
 * depends on the grid it lands in — a hard-coded factor leaves the render
 * floating in empty space at some breakpoints.
 */
export function CampaignThumbnail({
  design,
  className,
}: {
  design: CampaignDesign;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const width = container.clientWidth;
      if (width > 0) setScale(width / THUMBNAIL_REFERENCE_WIDTH);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn(
        "pointer-events-none relative overflow-hidden bg-slate-100",
        className,
      )}
    >
      {scale > 0 ? (
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: THUMBNAIL_REFERENCE_WIDTH,
            transform: `scale(${scale})`,
          }}
        >
          <CampaignPreview design={design} width={600} />
        </div>
      ) : null}
    </div>
  );
}

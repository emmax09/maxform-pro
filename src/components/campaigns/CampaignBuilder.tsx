/**
 * Campaign builder.
 *
 * The same canvas paradigm as the Form builder, Ticket Studio, and Email
 * Templates: drag from a palette, select on the canvas, edit the selection, see
 * the result live. Nothing here is a new editing tool — only the marketing
 * blocks are new.
 *
 * Two layouts share this component. In `immersive` mode (the full-screen
 * builder) a single docked column on the left carries both the palette and the
 * settings, swapping between them as blocks are added and picked, so the eye
 * never has to cross the canvas to a second panel. The panel layout keeps the
 * original palette-left / properties-right arrangement for embedding inside a
 * dashboard tab.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useTheme } from "next-themes";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  BarChart3,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock,
  Code2,
  Columns2,
  Copy,
  Frame,
  GripVertical,
  Heading1,
  Hexagon,
  Image as ImageIcon,
  Images,
  List,
  LayoutTemplate,
  ListChecks,
  Megaphone,
  Menu,
  MessageSquareQuote,
  Minus,
  Monitor,
  RectangleHorizontal,
  MoveVertical,
  Package,
  Palette,
  PanelTop,
  Quote,
  ReceiptText,
  Rows3,
  Scale,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Plus,
  Settings2,
  Smartphone,
  Eye,
  Pencil,
  Square,
  SquareSplitVertical,
  Star,
  Tablet,
  TextCursorInput,
  Tag,
  TicketPercent,
  TicketCheck,
  Link2,
  Redo2,
  Trash2,
  Undo2,
  Type,
  Video,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PaymentProduct } from "@/components/payments/payment-types";
import { cn } from "@/lib/utils";
import { VariableText } from "@/components/ui/variable-text";
import { hasVariables } from "@/lib/template-variables";
import { uploadFileToStorage } from "@/lib/storage";

import {
  BLOCKS_WITH_ELEMENT_FILL,
  campaignAlignments,
  campaignBlockDescriptions,
  campaignBlockGroups,
  campaignBlockKeywords,
  campaignBlockLabels,
  campaignColor,
  campaignFontFamilies,
  campaignSpamReport,
  createCampaignBlock,
  createCampaignEntry,
  emptyBoxSpacing,
  normalizeBoxSpacing,
  resolveCampaignVideo,
  socialNetworkLabels,
  type CampaignAlign,
  type CampaignBlock,
  type CampaignBlockContainer,
  type CampaignBlockDesign,
  type CampaignBlockType,
  type CampaignBoxSpacing,
  type CampaignBreakpoint,
  type CampaignContainer,
  type CampaignDesign,
  type CampaignPreviewDevice,
  type CampaignPreviewTheme,
  type CampaignSocialItem,
} from "./campaign-blocks";
import { CampaignBlockBody, CampaignPreview } from "./CampaignPreview";
import {
  formatBytes,
  validateCampaignAsset,
} from "./campaign-uploads";

const blockIcons: Record<CampaignBlockType, LucideIcon> = {
  label: Tag,
  heading: Heading1,
  text: Type,
  list: List,
  quote: Quote,
  button: RectangleHorizontal,
  button_group: Rows3,
  image: ImageIcon,
  image_gallery: Images,
  video: Video,
  logo: Hexagon,
  divider: Minus,
  spacer: MoveVertical,
  columns: Columns2,
  hero: PanelTop,
  product_grid: Package,
  coupon: TicketPercent,
  order_summary: ReceiptText,
  countdown: Clock,
  social: Share2,
  menu: Menu,
  testimonial: MessageSquareQuote,
  stats: BarChart3,
  feature_list: ListChecks,
  cta_banner: Megaphone,
  rating: Star,
  event_details: CalendarDays,
  event_ticket: TicketCheck,
  event_access: Link2,
  calendar_links: CalendarPlus,
  html: Code2,
  form: TextCursorInput,
  compliance_footer: ShieldCheck,
};

/**
 * Blocks whose main line of copy can be typed straight into on the canvas.
 * Structured blocks (stats, order lines, galleries) are edited in the panel,
 * where their several fields have somewhere to live.
 */
const INLINE_EDITABLE_BLOCKS: CampaignBlockType[] = [
  "label",
  "heading",
  "text",
  "button",
  "quote",
  "testimonial",
];

/** Block types whose Details tab is a list of label/value rows. */
const ENTRY_BLOCKS: CampaignBlockType[] = [
  "button_group",
  "columns",
  "menu",
  "stats",
  "feature_list",
  "order_summary",
  "form",
];

const entryEditorLabels: Record<
  string,
  { heading: string; singular: string; labelField: string; valueField: string }
> = {
  button_group: {
    heading: "Buttons",
    singular: "button",
    labelField: "Button text",
    valueField: "Link",
  },
  columns: {
    heading: "Columns",
    singular: "column",
    labelField: "Column title",
    valueField: "Column text",
  },
  menu: {
    heading: "Links",
    singular: "link",
    labelField: "Link text",
    valueField: "URL",
  },
  stats: {
    heading: "Stats",
    singular: "stat",
    labelField: "Caption",
    valueField: "Number",
  },
  feature_list: {
    heading: "Features",
    singular: "feature",
    labelField: "Feature title",
    valueField: "Detail",
  },
  form: {
    heading: "Fields",
    singular: "field",
    labelField: "Field label",
    valueField: "Placeholder",
  },
  order_summary: {
    heading: "Line items",
    singular: "line",
    labelField: "Description",
    valueField: "Amount",
  },
};

/**
 * What the thing inside each block is called, so the Design tab can say "the
 * button" rather than the generic "element".
 */
const elementNouns: Partial<Record<CampaignBlockType, string>> = {
  heading: "heading",
  text: "paragraph",
  label: "eyebrow",
  button: "button",
  button_group: "buttons",
  image: "image",
  image_gallery: "images",
  video: "video",
  logo: "logo",
  quote: "quote",
  testimonial: "quote",
  list: "list",
  divider: "rule",
  spacer: "spacer",
  hero: "banner",
  cta_banner: "banner",
  coupon: "code",
  countdown: "timer",
  social: "icons",
  menu: "links",
  stats: "figures",
  feature_list: "features",
  rating: "stars",
  product_grid: "products",
  order_summary: "table",
  event_details: "details",
  event_ticket: "ticket",
  event_access: "secure access",
  calendar_links: "calendar links",
  columns: "columns",
  html: "markup",
  form: "form fields",
  compliance_footer: "footer",
};

/** What the filled element inside each block is actually called. */
const elementFillLabels: Partial<Record<CampaignBlockType, string>> = {
  button: "Button colour",
  button_group: "Button colour",
  cta_banner: "Banner colour",
  coupon: "Code colour",
  hero: "Overlay colour",
  feature_list: "Tick colour",
  stats: "Figure colour",
};

const alignmentIcons: Record<CampaignAlign, LucideIcon> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
  justify: AlignJustify,
};

/** What the block's main line of copy is called, per block type. */
const textFieldLabels: Record<string, string> = {
  label: "Eyebrow text",
  heading: "Heading",
  text: "Message",
  button: "Button label",
  testimonial: "Quote",
  quote: "Quote",
  video: "Caption",
  coupon: "Lead-in text",
  cta_banner: "Headline",
  rating: "Caption",
  order_summary: "Title",
  event_details: "Title",
  event_ticket: "Section title",
  event_access: "Section title",
  calendar_links: "Link label",
  countdown: "Label",
};

/** ISO instant to the value a datetime-local input expects. */
const toLocalInputValue = (value: string | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const DRAG_NEW_BLOCK = "application/x-maxform-campaign-block-type";
const DRAG_MOVE_BLOCK = "application/x-maxform-campaign-block-id";
/**
 * Campaign email images are hosted on the workspace's public object-storage
 * origin. That keeps the message small and gives inboxes a normal HTTPS URL
 * they can fetch; data URIs are not consistently displayed by email clients.
 * This matches the server's `email_image` storage policy.
 */
const MAX_EMAIL_IMAGE_BYTES = 5 * 1024 * 1024;
const EMAIL_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/**
 * The block palette.
 *
 * A tile grid rather than a list: three to a row, each an icon over its name,
 * which is how a block library is scanned — by shape, not by reading down a
 * column. Search matches the label plus a keyword list, so "discount" finds
 * the coupon block and "nav" finds the menu.
 */
function BlockPalette({
  onAdd,
  compact = false,
}: {
  onAdd: (type: CampaignBlockType) => void;
  compact?: boolean;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!query) return campaignBlockGroups;
    const matches = (type: CampaignBlockType) =>
      `${campaignBlockLabels[type]} ${campaignBlockKeywords[type]} ${campaignBlockDescriptions[type]}`
        .toLowerCase()
        .includes(query);
    return campaignBlockGroups
      .map((group) => ({ ...group, types: group.types.filter(matches) }))
      .filter((group) => group.types.length);
  }, [query]);

  return (
    <div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search blocks"
          aria-label="Search blocks"
          className="h-8 pl-8 text-[12px]"
        />
      </div>

      {groups.map((group) => (
        <div key={group.group} className="mb-4 last:mb-0">
          <p className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
            {group.group}
          </p>
          <div
            className={cn(
              "grid gap-1.5",
              compact ? "grid-cols-2" : "grid-cols-3",
            )}
          >
            {group.types.map((type) => {
              const Icon = blockIcons[type];
              return (
                <button
                  key={type}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(DRAG_NEW_BLOCK, type);
                  }}
                  onClick={() => onAdd(type)}
                  title={campaignBlockDescriptions[type]}
                  className="group flex aspect-square cursor-grab flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-background p-1.5 text-center transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent hover:shadow-xs active:cursor-grabbing"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  <span className="w-full truncate text-[9.5px] font-medium leading-tight text-muted-foreground transition-colors group-hover:text-foreground">
                    {campaignBlockLabels[type]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {!groups.length ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
          No block matches “{search.trim()}”.
        </p>
      ) : null}
    </div>
  );
}

function DropTarget({
  onDrop,
}: {
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        setActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setActive(false)}
      onDrop={(event) => {
        setActive(false);
        onDrop(event);
      }}
      className={cn(
        "h-2 transition-all",
        active &&
          "my-1 h-8 rounded-md border border-dashed border-primary bg-primary/5",
      )}
    />
  );
}

/**
 * A block on the canvas.
 *
 * The default state is the email and nothing else — no label, no counter, no
 * frame. Editing affordances appear on hover as a small floating toolbar, and
 * selection is a coloured outline. The canvas should read as the message being
 * written, not as a list of records about it.
 */
function CanvasBlock({
  accent,
  block,
  breakpoint,
  index,
  onContentChange,
  onDelete,
  onDuplicate,
  onSelect,
  selected,
  total,
}: {
  accent: string;
  block: CampaignBlock;
  breakpoint: CampaignBreakpoint;
  index: number;
  onContentChange: (content: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSelect: () => void;
  selected: boolean;
  total: number;
}) {
  const Icon = blockIcons[block.type];
  // Editing happens on the selected block only: a canvas where every line is
  // writable makes it impossible to click a block without typing into it.
  const inlineEditable = selected && INLINE_EDITABLE_BLOCKS.includes(block.type);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      aria-label={`Select ${campaignBlockLabels[block.type]} block, ${index + 1} of ${total}`}
      aria-pressed={selected}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DRAG_MOVE_BLOCK, block.id);
      }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group relative cursor-pointer rounded-[6px] outline-hidden transition-shadow",
        selected
          ? "shadow-[0_0_0_2px_hsl(var(--primary))]"
          : "hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.35)] focus-visible:shadow-[0_0_0_2px_hsl(var(--primary)/0.5)]",
      )}
    >
      {/* Floating toolbar, hidden until the block is approached. */}
      <div
        className={cn(
          "absolute -top-3.5 right-1.5 z-10 flex items-center gap-0.5 rounded-md border border-border bg-popover px-0.5 py-0.5 shadow-xs transition-opacity",
          selected
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        <span
          className="flex h-6 cursor-grab items-center gap-1 rounded px-1.5 text-[9.5px] font-medium text-muted-foreground"
          title={campaignBlockLabels[block.type]}
        >
          <GripVertical className="h-3 w-3" />
          <Icon className="h-3 w-3" />
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate();
          }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Duplicate ${campaignBlockLabels[block.type]} block`}
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${campaignBlockLabels[block.type]} block`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* A selected text block is edited in place — the real heading or
          paragraph becomes the input, so what is typed already looks the way
          it will land. Everything else keeps pointer events off so a click
          selects the block rather than following a link inside it. */}
      <div className={cn(inlineEditable ? "cursor-text" : "pointer-events-none")}>
        <CampaignBlockBody
          accent={accent}
          block={block}
          breakpoint={breakpoint}
          editable={inlineEditable ? onContentChange : undefined}
        />
      </div>
    </div>
  );
}

/**
 * The insert point between two blocks. A hairline that becomes a "+" on
 * approach, so adding a block mid-document does not mean dragging from the
 * palette and aiming.
 */
function InsertPoint({
  onInsert,
  onDrop,
}: {
  onInsert: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        setActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setActive(false)}
      onDrop={(event) => {
        setActive(false);
        onDrop(event);
      }}
      className={cn(
        "group/insert relative flex items-center justify-center transition-all",
        active ? "h-9" : "h-2.5",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-opacity",
          active
            ? "bg-primary opacity-100"
            : "bg-primary/40 opacity-0 group-hover/insert:opacity-100",
        )}
      />
      <button
        type="button"
        aria-label="Add a block here"
        onClick={onInsert}
        className={cn(
          "relative z-10 flex h-5 w-5 items-center justify-center rounded-full border border-primary bg-background text-primary shadow-xs transition-opacity",
          active
            ? "opacity-100"
            : "opacity-0 group-hover/insert:opacity-100 focus-visible:opacity-100",
        )}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

function SpamScorePanel({
  design,
  previewText,
  subject,
}: {
  design: CampaignDesign;
  previewText: string;
  subject: string;
}) {
  const report = useMemo(
    () => campaignSpamReport({ subject, previewText, design }),
    [design, previewText, subject],
  );
  const tone =
    report.rating === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : report.rating === "fair"
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <p className="text-[12px] font-semibold">Spam check</p>
        </div>
        <span className={cn("text-[12px] font-semibold capitalize", tone)}>
          {report.rating} · {report.score}
        </span>
      </div>
      <p className="text-[10px] leading-4 text-muted-foreground">
        Guidance on the content itself. Whether a message reaches the inbox also
        depends on sender reputation and authentication, which this cannot see.
      </p>
      {report.findings.length ? (
        <ul className="space-y-2">
          {report.findings.map((finding) => (
            <li key={finding.id} className="flex gap-2">
              <span
                className={cn(
                  "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                  finding.severity === "high"
                    ? "bg-rose-500"
                    : finding.severity === "medium"
                      ? "bg-amber-500"
                      : "bg-slate-400",
                )}
              />
              <span className="text-[10px] leading-4 text-muted-foreground">
                {finding.message}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10px] leading-4 text-emerald-600 dark:text-emerald-400">
          Nothing flagged in the subject, preheader, or body.
        </p>
      )}
    </section>
  );
}

function ProductPicker({
  block,
  onChange,
  products,
}: {
  block: CampaignBlock;
  onChange: (patch: Partial<CampaignBlock>) => void;
  products: PaymentProduct[];
}) {
  const source = block.sourceType === "tickets" ? "ticket_type" : "catalog";
  const available = products.filter(
    (product) =>
      product.active &&
      (source === "ticket_type"
        ? product.sourceType === "ticket_type" || product.sourceType === "event"
        : true),
  );
  const selected = new Set((block.items || []).map((item) => item.id));
  const formatPrice = (product: PaymentProduct) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: product.currency || "USD",
    }).format(product.price);

  const toggle = (product: PaymentProduct) => {
    const items = block.items || [];
    if (selected.has(product.id)) {
      onChange({ items: items.filter((item) => item.id !== product.id) });
      return;
    }
    onChange({
      items: [
        ...items,
        {
          id: product.id,
          title: product.name,
          price: formatPrice(product),
          imageSrc: product.imageUrl,
          href: "",
        },
      ],
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Source</Label>
        <Select
          value={block.sourceType || "catalog"}
          onValueChange={(value) =>
            onChange({
              sourceType: value as CampaignBlock["sourceType"],
              items: [],
            })
          }
        >
          <SelectTrigger aria-label="Product grid source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="catalog">Products catalog</SelectItem>
            <SelectItem value="tickets">Event ticket types</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Columns</Label>
        <Select
          value={String(block.columns || 2)}
          onValueChange={(value) =>
            onChange({ columns: Number(value) as 1 | 2 | 3 })
          }
        >
          <SelectTrigger aria-label="Product grid columns">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">One per row</SelectItem>
            <SelectItem value="2">Two per row</SelectItem>
            <SelectItem value="3">Three per row</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Items</Label>
        {available.length ? (
          <div className="dashboard-scroll max-h-52 space-y-1 overflow-y-auto overscroll-contain rounded-md border border-border p-1.5">
            {available.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => toggle(product)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-accent",
                  selected.has(product.id) && "bg-primary/10 text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{product.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {formatPrice(product)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-3 text-[10px] leading-4 text-muted-foreground">
            No active products found. Add them in the Payments module first.
          </p>
        )}
        <p className="text-[10px] leading-4 text-muted-foreground">
          Names and prices are read from the catalog each time this campaign is
          saved, so a promo never carries a stale price.
        </p>
      </div>
      {(block.items || []).map((item, index) => (
        <div key={item.id} className="space-y-1.5">
          <Label className="text-[10px]">{item.title} link</Label>
          <Input
            value={item.href}
            placeholder="https://"
            onChange={(event) => {
              const items = [...(block.items || [])];
              items[index] = { ...item, href: event.target.value };
              onChange({ items });
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A collapsible group in the property inspector.
 *
 * Sections start open or closed depending on how often they are reached for:
 * typography and colour are the everyday edits, borders and effects are not.
 */
function InspectorSection({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: LucideIcon;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-accent/50"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
          {title}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="space-y-2.5 border-t border-border px-2.5 py-2.5">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Compact [-] value [+] control, so a number is nudged rather than retyped. */
function StepperField({
  label,
  value,
  placeholder = "Auto",
  min = 0,
  max = 999,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number | undefined) => void;
}) {
  const nudge = (direction: 1 | -1) => {
    const base = value ?? 0;
    const next = Math.min(max, Math.max(min, Number((base + direction * step).toFixed(2))));
    onChange(next);
  };
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <div className="flex items-center rounded-md border border-border">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => nudge(-1)}
          className="flex h-7 w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          aria-label={label}
          type="number"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(event) =>
            onChange(event.target.value ? Number(event.target.value) : undefined)
          }
          className="h-7 min-w-0 flex-1 border-0 bg-transparent text-center text-[11px] outline-hidden [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix ? (
          <span className="shrink-0 pr-1 text-[9px] text-muted-foreground">
            {suffix}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => nudge(1)}
          className="flex h-7 w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** Segmented control — one visible row of choices instead of a dropdown. */
function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: LucideIcon }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <div
        role="radiogroup"
        aria-label={label}
        className="grid gap-0.5 rounded-md border border-border p-0.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}
      >
        {options.map((option) => {
          const OptionIcon = option.icon;
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex h-6 items-center justify-center gap-1 rounded text-[10px] font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {OptionIcon ? <OptionIcon className="h-3 w-3" /> : option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Media source input: upload a file or point at a URL.
 *
 * Both are offered because they solve different problems � an upload is
 * self-contained but inflates the message, a hosted URL keeps the email small
 * but depends on that host staying up. Which one is right is the sender's call.
 */
function MediaSourceField({
  label,
  value,
  error,
  uploading = false,
  accept = EMAIL_IMAGE_ACCEPT,
  onUpload,
  onUrlChange,
}: {
  label: string;
  value: string;
  error?: string;
  uploading?: boolean;
  accept?: string;
  onUpload: (file: File | undefined) => void;
  onUrlChange: (value: string) => void;
}) {
  const isUpload = value.startsWith("data:");
  const [mode, setMode] = useState<"upload" | "url">(
    isUpload || !value ? "upload" : "url",
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px]">{label}</Label>
        <div className="flex rounded-md border border-border p-0.5">
          {(
            [
              ["upload", "Upload"],
              ["url", "URL"],
            ] as const
          ).map(([option, optionLabel]) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              disabled={uploading}
              aria-pressed={mode === option}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                mode === option
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {optionLabel}
            </button>
          ))}
        </div>
      </div>

      {mode === "upload" ? (
        <>
          <Input
            type="file"
            accept={accept}
            aria-label={`${label} upload`}
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              onUpload(file);
            }}
            className="text-[11px] file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-[11px]"
          />
          <p className="text-[9.5px] leading-4 text-muted-foreground">
            {uploading
              ? "Uploading to secure public email storage…"
              : "JPG, PNG, WebP or GIF. Up to 5 MB. Uploaded images use a public HTTPS URL so inboxes can load them."}
          </p>
        </>
      ) : (
        <>
          <Input
            value={isUpload ? "" : value}
            aria-label={`${label} URL`}
            placeholder="https://cdn.example.com/image.png"
            onChange={(event) => onUrlChange(event.target.value)}
            className="text-[11px]"
          />
          <p className="text-[9.5px] leading-4 text-muted-foreground">
            Must be an https link that stays reachable after the send.
          </p>
        </>
      )}

      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-border p-1.5">
          <img
            src={value}
            alt=""
            className="h-10 w-10 shrink-0 rounded object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
            {isUpload ? "Uploaded file" : value}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            aria-label={`Remove ${label.toLowerCase()}`}
            disabled={uploading}
            onClick={() => onUrlChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * Font picker with search.
 *
 * The list is long enough that scanning it is slower than typing, and every
 * entry previews in its own face so the choice is made by looking rather than
 * by recognising a name.
 */
function FontFamilyField({
  id,
  value,
  placeholder = "Match campaign",
  onChange,
}: {
  id: string;
  value: string;
  placeholder?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const options = useMemo(
    () =>
      query
        ? campaignFontFamilies.filter((font) =>
            `${font.label} ${font.category}`.toLowerCase().includes(query),
          )
        : campaignFontFamilies,
    [query],
  );
  const selected = campaignFontFamilies.find((font) => font.value === value);

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]" htmlFor={id}>
        Font
      </Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next || undefined)}
      >
        <SelectTrigger id={id} className="h-8 text-[11.5px]">
          <SelectValue placeholder={placeholder}>
            <span style={{ fontFamily: selected?.value || undefined }}>
              {selected?.label || placeholder}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-[280px]">
          <div className="sticky top-0 z-10 -mx-1 mb-1 bg-popover px-1 pb-1.5 pt-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Search fonts"
                aria-label="Search fonts"
                className="h-7 pl-7 text-[11px]"
              />
            </div>
          </div>
          {options.map((font) => (
            <SelectItem key={font.label} value={font.value}>
              <span
                style={{ fontFamily: font.value || undefined }}
                className="text-[12px]"
              >
                {font.label}
              </span>
              <span className="ml-1.5 text-[9.5px] text-muted-foreground">
                {font.category}
              </span>
            </SelectItem>
          ))}
          {!options.length ? (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              No font matches “{search.trim()}”.
            </p>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The four-input control used for both padding and margin. */
function BoxSpacingField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CampaignBoxSpacing | undefined;
  onChange: (next: CampaignBoxSpacing) => void;
}) {
  const box = normalizeBoxSpacing(value);
  const sides = [
    ["top", "Top"],
    ["right", "Right"],
    ["bottom", "Bottom"],
    ["left", "Left"],
  ] as const;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">{label}</Label>
        <span className="text-[9.5px] text-muted-foreground">px</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {sides.map(([side, sideLabel]) => (
          <label key={side} className="block">
            <span className="sr-only">{`${label} ${sideLabel}`}</span>
            <Input
              aria-label={`${label} ${sideLabel}`}
              type="number"
              value={box[side]}
              onChange={(event) =>
                onChange({ ...box, [side]: Number(event.target.value) || 0 })
              }
              className="h-8 px-1.5 text-center text-[11px]"
            />
            <span
              aria-hidden="true"
              className="mt-0.5 block text-center text-[9px] text-muted-foreground"
            >
              {sideLabel}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** A colour input that can also be cleared back to "inherit from campaign". */
function DesignColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  onChange: (next: string | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]">{label}</Label>
      <div className="flex items-center gap-1.5">
        <input
          aria-label={label}
          type="color"
          value={value || fallback}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
        />
        <Input
          value={value || ""}
          onChange={(event) => onChange(event.target.value || undefined)}
          placeholder="Inherit"
          className="h-8 font-mono text-[11px]"
        />
        {value ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => onChange(undefined)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The Design tab, split the way the styles themselves are split.
 *
 * ELEMENT edits the thing inside the block — the button, the heading, the
 * image. CONTAINER edits the strip it sits on. Keeping them in separate,
 * labelled groups is what stops "put a border on this button" from drawing a
 * box around the whole section.
 */
function BlockDesignPanel({
  block,
  design,
  onChange,
}: {
  block: CampaignBlock;
  design: CampaignDesign;
  onChange: (patch: Partial<CampaignBlock>) => void;
}) {
  const current = block.design || {};
  const container = current.container || {};
  const [layer, setLayer] = useState<"element" | "container">("element");
  const patchDesign = (patch: Partial<CampaignBlockDesign>) =>
    onChange({ design: { ...current, ...patch } });
  const patchContainer = (patch: Partial<CampaignBlockContainer>) =>
    onChange({ design: { ...current, container: { ...container, ...patch } } });

  const elementNoun = elementNouns[block.type] || "element";

  return (
    <div className="space-y-2">
      {/* Which layer is being edited, stated rather than implied. */}
      <div
        role="tablist"
        aria-label="Style layer"
        className="grid grid-cols-2 gap-0.5 rounded-md border border-border p-0.5"
      >
        {(
          [
            ["element", `The ${elementNoun}`, Type],
            ["container", "The block", Frame],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={layer === value}
            onClick={() => setLayer(value)}
            className={cn(
              "flex h-7 items-center justify-center gap-1.5 rounded text-[11px] font-medium transition-colors",
              layer === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {layer === "element" ? (
        <>
          <InspectorSection title="Typography" icon={Type} defaultOpen>
            <FontFamilyField
              id="block-font-family"
              value={current.fontFamily || ""}
              onChange={(fontFamily) => patchDesign({ fontFamily })}
            />
            <div className="grid grid-cols-2 gap-2">
              <StepperField
                label="Size"
                suffix="px"
                min={8}
                max={96}
                value={current.fontSize}
                onChange={(fontSize) => patchDesign({ fontSize })}
              />
              <StepperField
                label="Line height"
                min={0.8}
                max={3}
                step={0.05}
                value={current.lineHeight}
                onChange={(lineHeight) => patchDesign({ lineHeight })}
              />
            </div>
            <SegmentedField
              label="Weight"
              value={String(current.fontWeight ?? "")}
              options={[
                { value: "", label: "Auto" },
                { value: "300", label: "Light" },
                { value: "400", label: "Regular" },
                { value: "600", label: "Medium" },
                { value: "700", label: "Bold" },
              ]}
              onChange={(weight) =>
                patchDesign({
                  fontWeight: weight
                    ? (Number(weight) as CampaignBlockDesign["fontWeight"])
                    : undefined,
                })
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <StepperField
                label="Letter spacing"
                suffix="px"
                min={-5}
                max={20}
                step={0.1}
                value={current.letterSpacing}
                onChange={(letterSpacing) => patchDesign({ letterSpacing })}
              />
              <SegmentedField
                label="Case"
                value={current.textTransform || "none"}
                options={[
                  { value: "none", label: "Aa" },
                  { value: "uppercase", label: "AA" },
                  { value: "capitalize", label: "Ab" },
                ]}
                onChange={(textTransform) =>
                  patchDesign({
                    textTransform:
                      textTransform as CampaignBlockDesign["textTransform"],
                  })
                }
              />
            </div>
            <SegmentedField
              label="Text alignment"
              value={(current.textAlign || block.align || "left") as CampaignAlign}
              options={campaignAlignments.map((option) => ({
                value: option.value,
                label: option.label,
                icon: alignmentIcons[option.value],
              }))}
              onChange={(align) =>
                onChange({ align, design: { ...current, textAlign: align } })
              }
            />
          </InspectorSection>

          <InspectorSection title="Colours" icon={Palette} defaultOpen>
            <DesignColorField
              label="Text colour"
              value={current.textColor}
              fallback="#182033"
              onChange={(textColor) => patchDesign({ textColor })}
            />
            {BLOCKS_WITH_ELEMENT_FILL.includes(block.type) ? (
              <DesignColorField
                label={elementFillLabels[block.type] || "Fill"}
                value={current.elementBackground}
                fallback={campaignColor(design.accent, "#635BFF")}
                onChange={(elementBackground) =>
                  patchDesign({ elementBackground })
                }
              />
            ) : null}
          </InspectorSection>

          <InspectorSection title="Border" icon={Square}>
            {/* Lands on the element itself — a button's outline hugs the
                button, not the strip it sits on. */}
            <div className="grid grid-cols-2 gap-2">
              <StepperField
                label="Width"
                suffix="px"
                min={0}
                max={24}
                value={current.borderWidth}
                onChange={(borderWidth) => patchDesign({ borderWidth })}
              />
              <StepperField
                label="Radius"
                suffix="px"
                min={0}
                max={64}
                value={current.borderRadius}
                onChange={(borderRadius) => patchDesign({ borderRadius })}
              />
            </div>
            {current.borderWidth ? (
              <>
                <SegmentedField
                  label="Style"
                  value={current.borderStyle || "solid"}
                  options={[
                    { value: "solid", label: "Solid" },
                    { value: "dashed", label: "Dashed" },
                    { value: "dotted", label: "Dotted" },
                  ]}
                  onChange={(borderStyle) =>
                    patchDesign({
                      borderStyle:
                        borderStyle as CampaignBlockDesign["borderStyle"],
                    })
                  }
                />
                <DesignColorField
                  label="Border colour"
                  value={current.borderColor}
                  fallback="#E2E8F0"
                  onChange={(borderColor) => patchDesign({ borderColor })}
                />
              </>
            ) : null}
          </InspectorSection>

          <InspectorSection title="Size and spacing" icon={MoveVertical}>
            <div className="grid grid-cols-2 gap-2">
              <StepperField
                label="Width"
                suffix="px"
                min={0}
                max={800}
                step={10}
                value={current.width}
                onChange={(width) => patchDesign({ width })}
              />
              <StepperField
                label="Height"
                suffix="px"
                min={0}
                max={800}
                step={10}
                value={current.height}
                onChange={(height) => patchDesign({ height })}
              />
            </div>
            {["image", "video", "logo", "hero"].includes(block.type) ? (
              <SegmentedField
                label="Fit"
                value={current.objectFit || "cover"}
                options={[
                  { value: "cover", label: "Cover" },
                  { value: "contain", label: "Contain" },
                  { value: "fill", label: "Fill" },
                ]}
                onChange={(objectFit) =>
                  patchDesign({
                    objectFit: objectFit as CampaignBlockDesign["objectFit"],
                  })
                }
              />
            ) : null}
            <BoxSpacingField
              label="Inner padding"
              value={current.elementPadding}
              onChange={(elementPadding) => patchDesign({ elementPadding })}
            />
          </InspectorSection>

          <InspectorSection title="Effects" icon={Wand2}>
            <StepperField
              label="Opacity"
              suffix="%"
              min={0}
              max={100}
              step={5}
              value={current.opacity}
              onChange={(opacity) => patchDesign({ opacity })}
            />
            <SegmentedField
              label="Shadow"
              value={current.shadow || "none"}
              options={[
                { value: "none", label: "None" },
                { value: "sm", label: "S" },
                { value: "md", label: "M" },
                { value: "lg", label: "L" },
              ]}
              onChange={(shadow) =>
                patchDesign({ shadow: shadow as CampaignBlockDesign["shadow"] })
              }
            />
            <div className="space-y-2 border-t border-border pt-2.5">
              <p className="text-[9.5px] leading-4 text-muted-foreground">
                Hover styling shows in the builder. Most inboxes strip :hover.
              </p>
              <DesignColorField
                label="Hover text"
                value={current.hoverTextColor}
                fallback="#182033"
                onChange={(hoverTextColor) => patchDesign({ hoverTextColor })}
              />
              <DesignColorField
                label="Hover fill"
                value={current.hoverBackgroundColor}
                fallback="#F1F5F9"
                onChange={(hoverBackgroundColor) =>
                  patchDesign({ hoverBackgroundColor })
                }
              />
            </div>
          </InspectorSection>

          <InspectorSection title="Responsive" icon={Smartphone}>
            <p className="text-[9.5px] leading-4 text-muted-foreground">
              Narrower screens inherit these values and override only what you
              set here.
            </p>
            {(
              [
                ["tablet", "Tablet", Tablet],
                ["mobile", "Mobile", Smartphone],
              ] as const
            ).map(([key, label, DeviceIcon]) => {
              const values = current[key] || {};
              const patchDevice = (patch: Partial<typeof values>) =>
                patchDesign({ [key]: { ...values, ...patch } });
              return (
                <div
                  key={key}
                  className="space-y-2 rounded-md border border-border p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[10.5px] font-medium">
                      <DeviceIcon className="h-3 w-3" />
                      {label}
                    </span>
                    {Object.keys(values).length ? (
                      <button
                        type="button"
                        onClick={() => patchDesign({ [key]: undefined })}
                        className="text-[9.5px] text-muted-foreground hover:text-foreground"
                      >
                        Reset
                      </button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <StepperField
                      label="Font size"
                      suffix="px"
                      min={8}
                      max={96}
                      value={values.fontSize}
                      onChange={(fontSize) => patchDevice({ fontSize })}
                    />
                    <StepperField
                      label="Line height"
                      min={0.8}
                      max={3}
                      step={0.05}
                      value={values.lineHeight}
                      onChange={(lineHeight) => patchDevice({ lineHeight })}
                    />
                  </div>
                </div>
              );
            })}
          </InspectorSection>
        </>
      ) : (
        <>
          <InspectorSection title="Background" icon={ImageIcon} defaultOpen>
            <DesignColorField
              label="Block background"
              value={container.backgroundColor}
              fallback={campaignColor(design.cardBackground, "#FFFFFF")}
              onChange={(backgroundColor) =>
                patchContainer({ backgroundColor })
              }
            />
            <SegmentedField
              label="Fill"
              value={
                container.gradient?.from
                  ? "gradient"
                  : container.backgroundImage
                    ? "image"
                    : "solid"
              }
              options={[
                { value: "solid", label: "Solid" },
                { value: "gradient", label: "Gradient" },
                { value: "image", label: "Image" },
              ]}
              onChange={(mode) => {
                if (mode === "solid") {
                  patchContainer({
                    gradient: undefined,
                    backgroundImage: undefined,
                  });
                  return;
                }
                if (mode === "gradient") {
                  patchContainer({
                    backgroundImage: undefined,
                    gradient: container.gradient || {
                      from: campaignColor(design.accent, "#635BFF"),
                      to: "#FFFFFF",
                      angle: 180,
                    },
                  });
                  return;
                }
                patchContainer({ gradient: undefined, backgroundImage: "" });
              }}
            />
            {container.gradient ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <DesignColorField
                    label="From"
                    value={container.gradient.from}
                    fallback="#635BFF"
                    onChange={(from) =>
                      patchContainer({
                        gradient: {
                          ...container.gradient!,
                          from: from || "#635BFF",
                        },
                      })
                    }
                  />
                  <DesignColorField
                    label="To"
                    value={container.gradient.to}
                    fallback="#FFFFFF"
                    onChange={(to) =>
                      patchContainer({
                        gradient: {
                          ...container.gradient!,
                          to: to || "#FFFFFF",
                        },
                      })
                    }
                  />
                </div>
                <StepperField
                  label="Angle"
                  suffix="deg"
                  min={0}
                  max={360}
                  step={15}
                  value={container.gradient.angle}
                  onChange={(angle) =>
                    patchContainer({
                      gradient: { ...container.gradient!, angle: angle ?? 180 },
                    })
                  }
                />
              </>
            ) : null}
            {container.backgroundImage !== undefined && !container.gradient ? (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">
                  Image URL
                </Label>
                <Input
                  aria-label="Block background image URL"
                  value={container.backgroundImage}
                  placeholder="https://"
                  onChange={(event) =>
                    patchContainer({ backgroundImage: event.target.value })
                  }
                  className="h-7 text-[11px]"
                />
              </div>
            ) : null}
          </InspectorSection>

          <InspectorSection title="Spacing" icon={MoveVertical} defaultOpen>
            <BoxSpacingField
              label="Padding"
              value={container.padding}
              onChange={(padding) => patchContainer({ padding })}
            />
            <BoxSpacingField
              label="Margin"
              value={container.margin}
              onChange={(margin) => patchContainer({ margin })}
            />
          </InspectorSection>

          <InspectorSection title="Layout" icon={Frame}>
            <StepperField
              label="Max width"
              suffix="px"
              min={0}
              max={900}
              step={10}
              value={container.maxWidth}
              onChange={(maxWidth) => patchContainer({ maxWidth })}
            />
            <SegmentedField
              label="Align contents"
              value={(container.align || "left") as CampaignAlign}
              options={campaignAlignments.map((option) => ({
                value: option.value,
                label: option.label,
                icon: alignmentIcons[option.value],
              }))}
              onChange={(align) => patchContainer({ align })}
            />
          </InspectorSection>

          <InspectorSection title="Border" icon={Square}>
            <div className="grid grid-cols-2 gap-2">
              <StepperField
                label="Width"
                suffix="px"
                min={0}
                max={24}
                value={container.borderWidth}
                onChange={(borderWidth) => patchContainer({ borderWidth })}
              />
              <StepperField
                label="Radius"
                suffix="px"
                min={0}
                max={64}
                value={container.borderRadius}
                onChange={(borderRadius) => patchContainer({ borderRadius })}
              />
            </div>
            {container.borderWidth ? (
              <DesignColorField
                label="Border colour"
                value={container.borderColor}
                fallback="#E2E8F0"
                onChange={(borderColor) => patchContainer({ borderColor })}
              />
            ) : null}
          </InspectorSection>

          <InspectorSection title="Effects" icon={Wand2}>
            <StepperField
              label="Opacity"
              suffix="%"
              min={0}
              max={100}
              step={5}
              value={container.opacity}
              onChange={(opacity) => patchContainer({ opacity })}
            />
            <SegmentedField
              label="Shadow"
              value={container.shadow || "none"}
              options={[
                { value: "none", label: "None" },
                { value: "sm", label: "S" },
                { value: "md", label: "M" },
                { value: "lg", label: "L" },
              ]}
              onChange={(shadow) =>
                patchContainer({
                  shadow: shadow as CampaignBlockContainer["shadow"],
                })
              }
            />
          </InspectorSection>
        </>
      )}

      {Object.keys(current).length ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => onChange({ design: undefined })}
        >
          <X className="h-3.5 w-3.5" />
          Reset design
        </Button>
      ) : null}
    </div>
  );
}

/** The Advanced tab: identifiers, visibility, and a raw CSS escape hatch. */
function BlockAdvancedPanel({
  block,
  onChange,
}: {
  block: CampaignBlock;
  onChange: (patch: Partial<CampaignBlock>) => void;
}) {
  const current = block.advanced || {};
  const patchAdvanced = (patch: Partial<typeof current>) =>
    onChange({ advanced: { ...current, ...patch } });

  return (
    <div className="space-y-4">
      <section className="space-y-2.5">
        <p className="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
          Identifiers
        </p>
        <div className="space-y-1.5">
          <Label className="text-[11px]" htmlFor="block-html-id">
            HTML id
          </Label>
          <Input
            id="block-html-id"
            value={current.htmlId || ""}
            placeholder="offer-section"
            onChange={(event) =>
              patchAdvanced({ htmlId: event.target.value || undefined })
            }
            className="h-8 font-mono text-[11px]"
          />
          <p className="text-[9.5px] leading-4 text-muted-foreground">
            Lets a link jump straight to this block.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px]" htmlFor="block-css-class">
            CSS class
          </Label>
          <Input
            id="block-css-class"
            value={current.cssClass || ""}
            placeholder="promo-band"
            onChange={(event) =>
              patchAdvanced({ cssClass: event.target.value || undefined })
            }
            className="h-8 font-mono text-[11px]"
          />
        </div>
      </section>

      <section className="space-y-2.5 border-t border-border pt-3.5">
        <p className="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
          Visibility
        </p>
        {(
          [
            ["hideOnMobile", "Hide on mobile", "Below 480px wide."],
            ["hideOnDesktop", "Hide on desktop", "480px and wider."],
          ] as const
        ).map(([key, label, hint]) => (
          <label
            key={key}
            className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <span className="min-w-0">
              <span className="block text-[11.5px] font-medium">{label}</span>
              <span className="block text-[9.5px] text-muted-foreground">
                {hint}
              </span>
            </span>
            <input
              type="checkbox"
              aria-label={label}
              checked={Boolean(current[key])}
              onChange={(event) =>
                patchAdvanced({ [key]: event.target.checked || undefined })
              }
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
            />
          </label>
        ))}
        {/* Both hidden means the block never renders anywhere, which is almost
            always a mistake rather than an intent. */}
        {current.hideOnMobile && current.hideOnDesktop ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-[10px] leading-4 text-amber-600">
            Hidden on every screen size — nobody will see this block.
          </p>
        ) : null}
      </section>

      <section className="space-y-2 border-t border-border pt-3.5">
        <p className="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
          Custom CSS
        </p>
        <Textarea
          aria-label="Custom CSS"
          value={current.customCss || ""}
          placeholder="box-shadow: 0 2px 8px rgba(0,0,0,.08)"
          rows={3}
          onChange={(event) =>
            patchAdvanced({ customCss: event.target.value || undefined })
          }
          className="font-mono text-[11px]"
        />
        <p className="text-[9.5px] leading-4 text-muted-foreground">
          Inline declarations, applied last so they win over the Design tab.
          Many inboxes strip anything beyond basic CSS.
        </p>
      </section>
    </div>
  );
}

/**
 * Campaign container settings — the sheet the blocks sit inside, split across
 * the same three concerns a block uses so the panel behaves consistently
 * whatever is selected.
 */
function ContainerPanel({
  tab,
  design,
  onDesignChange,
}: {
  tab: "details" | "design" | "advanced";
  design: CampaignDesign;
  onDesignChange: (design: CampaignDesign) => void;
}) {
  const container = design.container || {};
  const patch = (next: Partial<CampaignContainer>) =>
    onDesignChange({ ...design, container: { ...container, ...next } });

  const numberField = (
    key: "width" | "cornerRadius" | "stripeHeight" | "contentPadding",
    label: string,
    fallback: number,
  ) => (
    <div key={key} className="space-y-1.5">
      <Label className="text-[11px]" htmlFor={`container-${key}`}>
        {label}
      </Label>
      <Input
        id={`container-${key}`}
        type="number"
        value={container[key] ?? ""}
        placeholder={String(fallback)}
        onChange={(event) =>
          patch({
            [key]: event.target.value ? Number(event.target.value) : undefined,
          })
        }
        className="h-8 text-[11.5px]"
      />
    </div>
  );

  if (tab === "details") {
    return (
      <div className="space-y-4">
        <section className="space-y-2.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
            Header
          </p>
          <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-2">
            <div className="space-y-1.5">
              <Label className="text-[11px]" htmlFor="container-icon">
                Icon
              </Label>
              <Input
                id="container-icon"
                value={container.headerIcon || ""}
                placeholder="🎉"
                maxLength={4}
                onChange={(event) => patch({ headerIcon: event.target.value })}
                className="h-8 text-center text-[14px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]" htmlFor="container-title">
                Header title
              </Label>
              <Input
                id="container-title"
                value={container.headerTitle || ""}
                placeholder="Acme Events"
                onChange={(event) => patch({ headerTitle: event.target.value })}
                className="h-8 text-[11.5px]"
              />
            </div>
          </div>
          <p className="text-[9.5px] leading-4 text-muted-foreground">
            Leave both empty to send without a header band.
          </p>
        </section>

        <section className="space-y-1.5 border-t border-border pt-3.5">
          <Label className="text-[11px]" htmlFor="container-footer">
            Footer line
          </Label>
          <Input
            id="container-footer"
            value={design.footerText}
            placeholder="Sent by {{workspace.name}}"
            onChange={(event) =>
              onDesignChange({ ...design, footerText: event.target.value })
            }
            className="h-8 text-[11.5px]"
          />
          <VariableHint value={design.footerText || "Sent by {{workspace.name}}"} />
        </section>
      </div>
    );
  }

  if (tab === "design") {
    return (
      <div className="space-y-4">
        {/* Container-scoped colours only. Changing any of these paints the
            sheet the message sits on and nothing inside it. */}
        <section className="space-y-2.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
            Container colours
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["pageBackground", "Page", "#F5F7FB", "Behind the sheet"],
                ["cardBackground", "Sheet", "#FFFFFF", "The email itself"],
              ] as const
            ).map(([key, label, fallback, hint]) => (
              <label
                key={key}
                className="space-y-1 text-[10px] text-muted-foreground"
                title={hint}
              >
                {label}
                <input
                  aria-label={`${label} color`}
                  className="mt-1 h-8 w-full cursor-pointer rounded border border-border bg-transparent p-0.5"
                  type="color"
                  value={campaignColor(design[key], fallback)}
                  onChange={(event) =>
                    onDesignChange({ ...design, [key]: event.target.value })
                  }
                />
              </label>
            ))}
            <label className="space-y-1 text-[10px] text-muted-foreground">
              Top stripe
              <input
                aria-label="Top stripe color"
                className="mt-1 h-8 w-full cursor-pointer rounded border border-border bg-transparent p-0.5"
                type="color"
                value={campaignColor(
                  container.stripeColor,
                  campaignColor(design.accent, "#635BFF"),
                )}
                onChange={(event) => patch({ stripeColor: event.target.value })}
              />
            </label>
            {(
              [
                ["headerBackground", "Header fill", "#FFFFFF"],
                ["headerTextColor", "Header text", "#172033"],
              ] as const
            ).map(([key, label, fallback]) => (
              <label
                key={key}
                className="space-y-1 text-[10px] text-muted-foreground"
              >
                {label}
                <input
                  aria-label={label}
                  className="mt-1 h-8 w-full cursor-pointer rounded border border-border bg-transparent p-0.5"
                  type="color"
                  value={campaignColor(container[key], fallback)}
                  onChange={(event) => patch({ [key]: event.target.value })}
                />
              </label>
            ))}
          </div>
        </section>

        {/* Kept apart from the container colours above, and labelled for what
            it actually does: this one reaches into the message. */}
        <section className="space-y-2 border-t border-border pt-3.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
            Block defaults
          </p>
          <div className="flex items-center gap-2.5 rounded-lg border border-border p-2.5">
            <input
              aria-label="Accent color"
              className="h-9 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
              type="color"
              value={campaignColor(design.accent, "#635BFF")}
              onChange={(event) =>
                onDesignChange({ ...design, accent: event.target.value })
              }
            />
            <span className="min-w-0">
              <span className="block text-[11px] font-medium">Accent</span>
              <span className="block text-[9.5px] leading-4 text-muted-foreground">
                Buttons, eyebrows and links inside the email. Any block can
                override it on its own Design tab.
              </span>
            </span>
          </div>
        </section>

        <section className="space-y-2.5 border-t border-border pt-3.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
            Layout
          </p>
          <div className="grid grid-cols-2 gap-2">
            {numberField("width", "Width (px)", 600)}
            {numberField("cornerRadius", "Corners (px)", 18)}
            {numberField("stripeHeight", "Top stripe (px)", 7)}
            {numberField("contentPadding", "Padding (px)", 34)}
          </div>
        </section>

        <section className="space-y-1.5 border-t border-border pt-3.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
            Typography
          </p>
          <FontFamilyField
            id="container-font"
            value={container.fontFamily || ""}
            placeholder="Inter (default)"
            onChange={(fontFamily) => patch({ fontFamily })}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <p className="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
          Preheader text
        </p>
        <p className="text-[10px] leading-4 text-muted-foreground">
          The preview line is edited above the canvas, where it stays visible
          while you write.
        </p>
      </section>
      <section className="space-y-1.5 border-t border-border pt-3.5">
        <p className="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground">
          Export
        </p>
        <p className="text-[10px] leading-4 text-muted-foreground">
          Blocks hidden on mobile or desktop use a media query in the exported
          HTML. Custom CSS is set per block on its own Advanced tab, because
          most inboxes strip anything in a document-level stylesheet.
        </p>
      </section>
    </div>
  );
}

function BlockProperties({
  block,
  mailingAddress,
  onChange,
  products,
}: {
  block: CampaignBlock;
  mailingAddress: string;
  onChange: (patch: Partial<CampaignBlock>) => void;
  products: PaymentProduct[];
}) {
  const [imageError, setImageError] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  // Every block that carries a line of copy gets the text editor, so there is
  // no block whose words can only be changed by deleting and re-adding it.
  const textual = [
    "label",
    "heading",
    "text",
    "button",
    "testimonial",
    "quote",
    "video",
    "coupon",
    "cta_banner",
    "rating",
    "order_summary",
    "event_details",
    "event_ticket",
    "event_access",
    "calendar_links",
    "countdown",
  ].includes(block.type);

  // `field` lets the same reader serve blocks that store their image somewhere
  // other than `src` � the video block's poster frame, for instance.
  const uploadImage = (
    file: File | undefined,
    field: "src" | "posterSrc" = "src",
  ) => {
    setImageError("");
    if (!file) return;
    // Type and extension first — an .exe is refused for what it is, whatever
    // its size — then the storage policy limit.
    const rejection = validateCampaignAsset(file, "image");
    if (rejection) {
      setImageError(rejection);
      return;
    }
    // SVG is intentionally not accepted by public object storage: serving
    // user-provided SVG as an email image can expose active markup. Users can
    // still paste a trusted HTTPS SVG URL when their provider supports it.
    if (
      file.type.toLowerCase() === "image/svg+xml" ||
      file.name.toLowerCase().endsWith(".svg")
    ) {
      setImageError(
        "SVG uploads are not supported for email safety. Paste a trusted HTTPS image URL instead.",
      );
      return;
    }
    if (file.size > MAX_EMAIL_IMAGE_BYTES) {
      setImageError(
        `Email images have to be ${formatBytes(MAX_EMAIL_IMAGE_BYTES)} or smaller.`,
      );
      return;
    }
    setImageUploading(true);
    void uploadFileToStorage(file, {
      purpose: "email_image",
      visibility: "public",
      authenticated: true,
      fileName: file.name,
    })
      .then((stored) => {
        if (!stored.url || !/^https:\/\//i.test(stored.url)) {
          throw new Error(
            "The public image URL is unavailable. Configure public email storage or paste an HTTPS image URL.",
          );
        }
        setImageError("");
        onChange({ [field]: stored.url } as Partial<CampaignBlock>);
      })
      .catch((error) =>
        setImageError(
          error instanceof Error
            ? error.message
            : "That image could not be uploaded.",
        ),
      )
      .finally(() => setImageUploading(false));
  };

  return (
    <div className="space-y-3">
      {textual ? (
        <div className="space-y-1.5">
          <Label htmlFor="block-content">{textFieldLabels[block.type]}</Label>
          {["text", "testimonial", "quote"].includes(block.type) ? (
            <Textarea
              id="block-content"
              className="min-h-[110px]"
              value={block.content || ""}
              onChange={(event) => onChange({ content: event.target.value })}
            />
          ) : (
            <Input
              id="block-content"
              value={block.content || ""}
              onChange={(event) => onChange({ content: event.target.value })}
            />
          )}
          <p className="text-[9.5px] text-muted-foreground">
            {(block.content || "").length} characters
          </p>
        </div>
      ) : null}

      {/* The second line these blocks carry, which otherwise had no editor. */}
      {["hero", "coupon", "cta_banner", "form"].includes(block.type) ? (
        <div className="space-y-1.5">
          <Label htmlFor="block-subtext">Supporting line</Label>
          <Input
            id="block-subtext"
            value={block.subtext || ""}
            onChange={(event) => onChange({ subtext: event.target.value })}
          />
        </div>
      ) : null}

      {["cta_banner", "hero", "form"].includes(block.type) ? (
        <div className="space-y-1.5">
          <Label htmlFor="block-button-label">Button label</Label>
          <Input
            id="block-button-label"
            value={block.buttonLabel || ""}
            onChange={(event) => onChange({ buttonLabel: event.target.value })}
          />
        </div>
      ) : null}

      {block.type === "testimonial" ? (
        <div className="space-y-1.5">
          <Label>Attribution</Label>
          <Input
            value={block.attribution || ""}
            placeholder="Customer name, Company"
            onChange={(event) => onChange({ attribution: event.target.value })}
          />
        </div>
      ) : null}

      {block.type === "hero" ? (
        <>
          <div className="space-y-1.5">
            <Label>Heading</Label>
            <Input
              value={block.content || ""}
              onChange={(event) => onChange({ content: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Subtext</Label>
            <Textarea
              className="min-h-[70px]"
              value={block.subtext || ""}
              onChange={(event) => onChange({ subtext: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Button label</Label>
            <Input
              value={block.buttonLabel || ""}
              onChange={(event) =>
                onChange({ buttonLabel: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-hero-overlay">
              Overlay strength · {block.overlay ?? 45}%
            </Label>
            <input
              id="campaign-hero-overlay"
              type="range"
              min={0}
              max={80}
              value={block.overlay ?? 45}
              onChange={(event) =>
                onChange({ overlay: Number(event.target.value) })
              }
              className="w-full accent-primary"
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              Darkens the background so the heading stays readable over any
              image.
            </p>
          </div>
        </>
      ) : null}

      {block.type === "button" || block.type === "hero" ? (
        <div className="space-y-1.5">
          <Label>Destination link</Label>
          <Input
            value={block.href || ""}
            placeholder="https://"
            onChange={(event) => onChange({ href: event.target.value })}
          />
          <p className="text-[10px] leading-4 text-muted-foreground">
            Every https link is tracked so the click-map can show which one was
            used.
          </p>
        </div>
      ) : null}

      {block.type === "image" || block.type === "hero" ? (
        <div className="space-y-3">
          <MediaSourceField
            label={block.type === "hero" ? "Background image" : "Image"}
            value={block.src || ""}
            error={imageError}
            uploading={imageUploading}
            accept={EMAIL_IMAGE_ACCEPT}
            onUpload={uploadImage}
            onUrlChange={(src) => {
              setImageError("");
              onChange({ src });
            }}
          />
          {block.type === "image" ? (
            <div className="space-y-1.5">
              <Label>Image description</Label>
              <Input
                value={block.alt || ""}
                placeholder="Describe this image"
                onChange={(event) => onChange({ alt: event.target.value })}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {block.type === "spacer" ? (
        <div className="space-y-1.5">
          <Label>Height</Label>
          <Input
            type="number"
            min={8}
            max={120}
            value={block.height || 24}
            onChange={(event) =>
              onChange({ height: Number(event.target.value) || 24 })
            }
          />
        </div>
      ) : null}

      {block.type === "product_grid" ? (
        <ProductPicker
          block={block}
          onChange={onChange}
          products={products}
        />
      ) : null}

      {block.type === "countdown" ? (
        <>
          <div className="space-y-1.5">
            <Label>Label above the timer</Label>
            <Input
              value={block.content || ""}
              onChange={(event) => onChange({ content: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Deadline</Label>
            <Input
              type="datetime-local"
              value={
                block.deadline
                  ? new Date(
                      new Date(block.deadline).getTime() -
                        new Date().getTimezoneOffset() * 60_000,
                    )
                      .toISOString()
                      .slice(0, 16)
                  : ""
              }
              onChange={(event) =>
                onChange({
                  deadline: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : "",
                })
              }
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              Email cannot run scripts, so the sent message carries an image the
              server draws on each open. It shows the time left at that moment
              rather than counting down in place.
            </p>
          </div>
        </>
      ) : null}

      {block.type === "social" ? (
        <div className="space-y-2">
          <Label>Profiles</Label>
          {(block.socials || []).map((item, index) => (
            <div key={item.id} className="flex gap-1.5">
              <Select
                value={item.network}
                onValueChange={(value) => {
                  const socials = [...(block.socials || [])];
                  socials[index] = {
                    ...item,
                    network: value as CampaignSocialItem["network"],
                  };
                  onChange({ socials });
                }}
              >
                <SelectTrigger
                  className="w-[112px]"
                  aria-label={`Network ${index + 1}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(socialNetworkLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={item.href}
                placeholder="https://"
                onChange={(event) => {
                  const socials = [...(block.socials || [])];
                  socials[index] = { ...item, href: event.target.value };
                  onChange({ socials });
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="shrink-0 text-destructive"
                aria-label={`Remove ${socialNetworkLabels[item.network]}`}
                onClick={() =>
                  onChange({
                    socials: (block.socials || []).filter(
                      (entry) => entry.id !== item.id,
                    ),
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full text-[11px]"
            onClick={() =>
              onChange({
                socials: [
                  ...(block.socials || []),
                  {
                    id: `social-${Date.now()}`,
                    network: "website",
                    href: "https://",
                  },
                ],
              })
            }
          >
            Add a profile
          </Button>
        </div>
      ) : null}

      {block.type === "compliance_footer" ? (
        <>
          <div className="space-y-1.5">
            <Label>Unsubscribe link text</Label>
            <Input
              value={block.unsubscribeLabel || ""}
              onChange={(event) =>
                onChange({ unsubscribeLabel: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Physical mailing address</Label>
            <Textarea
              className="min-h-[80px]"
              value={block.mailingAddress || ""}
              placeholder="Street, city, region, postal code, country"
              onChange={(event) =>
                onChange({ mailingAddress: event.target.value })
              }
            />
            {mailingAddress && mailingAddress !== block.mailingAddress ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full text-[11px]"
                onClick={() => onChange({ mailingAddress })}
              >
                Use the address from Campaigns settings
              </Button>
            ) : null}
            <p className="text-[10px] leading-4 text-muted-foreground">
              Marketing email is required to carry a physical address. Sending is
              blocked until this is filled in.
            </p>
          </div>
        </>
      ) : null}

      {[
        "label",
        "heading",
        "text",
        "button",
        "image",
        "testimonial",
      ].includes(block.type) ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Alignment</Label>
            <div className="flex gap-1">
              {campaignAlignments.map((option) => {
                const Icon = alignmentIcons[option.value];
                return (
                  <Button
                    key={option.value}
                    type="button"
                    size="icon"
                    variant={
                      (block.align || "left") === option.value
                        ? "default"
                        : "outline"
                    }
                    aria-label={`Align ${option.label.toLowerCase()}`}
                    onClick={() => onChange({ align: option.value })}
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                );
              })}
            </div>
          </div>
          {block.type === "heading" ? (
            <div className="space-y-1.5">
              <Label>Size</Label>
              <Select
                value={block.size || "large"}
                onValueChange={(value) =>
                  onChange({ size: value as CampaignBlock["size"] })
                }
              >
                <SelectTrigger aria-label="Heading size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">Small</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      {["label", "heading", "text", "button"].includes(block.type) ? (
        <div className="space-y-1.5">
          <Label>Insert variable</Label>
          <div className="flex flex-wrap gap-1.5">
            {["{{contact.name}}", "{{contact.company}}", "{{workspace.name}}"].map(
              (token) => (
                <Button
                  key={token}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[9px]"
                  onClick={() =>
                    onChange({ content: `${block.content || ""}${token}` })
                  }
                >
                  {token}
                </Button>
              ),
            )}
          </div>
        </div>
      ) : null}

      {block.type === "list" ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="block-list-style">List style</Label>
            <Select
              value={block.listStyle || "bullet"}
              onValueChange={(value) =>
                onChange({ listStyle: value as CampaignBlock["listStyle"] })
              }
            >
              <SelectTrigger id="block-list-style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bullet">Bulleted</SelectItem>
                <SelectItem value="number">Numbered</SelectItem>
                <SelectItem value="check">Ticked</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Items</Label>
            {(block.listItems || []).map((item, index) => (
              <div key={index} className="flex gap-1.5">
                <Input
                  aria-label={`List item ${index + 1}`}
                  value={item}
                  onChange={(event) => {
                    const items = [...(block.listItems || [])];
                    items[index] = event.target.value;
                    onChange({ listItems: items });
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="shrink-0"
                  aria-label={`Remove list item ${index + 1}`}
                  onClick={() =>
                    onChange({
                      listItems: (block.listItems || []).filter(
                        (_, position) => position !== index,
                      ),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({ listItems: [...(block.listItems || []), "New point"] })
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </Button>
          </div>
        </>
      ) : null}

      {block.type === "quote" ? (
        <div className="space-y-1.5">
          <Label htmlFor="block-quote">Quote</Label>
          <Textarea
            id="block-quote"
            rows={3}
            value={block.content || ""}
            onChange={(event) => onChange({ content: event.target.value })}
          />
        </div>
      ) : null}

      {/* Menu links, button rows, stats, features, columns and order lines are
          all label/value pairs, so one editor serves them all. */}
      {ENTRY_BLOCKS.includes(block.type) ? (
        <div className="space-y-1.5">
          <Label>{entryEditorLabels[block.type].heading}</Label>
          {(block.entries || []).map((entry, index) => (
            <div
              key={entry.id}
              className="space-y-1.5 rounded-lg border border-border p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {index + 1}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label={`Remove ${entryEditorLabels[block.type].singular} ${index + 1}`}
                  onClick={() =>
                    onChange({
                      entries: (block.entries || []).filter(
                        (candidate) => candidate.id !== entry.id,
                      ),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Input
                aria-label={`${entryEditorLabels[block.type].labelField} ${index + 1}`}
                placeholder={entryEditorLabels[block.type].labelField}
                value={entry.label}
                onChange={(event) =>
                  onChange({
                    entries: (block.entries || []).map((candidate) =>
                      candidate.id === entry.id
                        ? { ...candidate, label: event.target.value }
                        : candidate,
                    ),
                  })
                }
              />
              <Input
                aria-label={`${entryEditorLabels[block.type].valueField} ${index + 1}`}
                placeholder={entryEditorLabels[block.type].valueField}
                value={entry.value}
                onChange={(event) =>
                  onChange({
                    entries: (block.entries || []).map((candidate) =>
                      candidate.id === entry.id
                        ? { ...candidate, value: event.target.value }
                        : candidate,
                    ),
                  })
                }
              />
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                entries: [...(block.entries || []), createCampaignEntry()],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add {entryEditorLabels[block.type].singular}
          </Button>
        </div>
      ) : null}

      {block.type === "coupon" ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="block-coupon-code">Code</Label>
            <Input
              id="block-coupon-code"
              value={block.couponCode || ""}
              onChange={(event) =>
                onChange({ couponCode: event.target.value.toUpperCase() })
              }
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="block-coupon-note">Small print</Label>
            <Input
              id="block-coupon-note"
              value={block.subtext || ""}
              onChange={(event) => onChange({ subtext: event.target.value })}
            />
          </div>
        </>
      ) : null}

      {block.type === "rating" ? (
        <div className="space-y-1.5">
          <Label htmlFor="block-rating">Stars</Label>
          <Select
            value={String(block.rating ?? 5)}
            onValueChange={(value) => onChange({ rating: Number(value) })}
          >
            <SelectTrigger id="block-rating">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value} {value === 1 ? "star" : "stars"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {block.type === "video" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="block-video-url">Video URL</Label>
            <Input
              id="block-video-url"
              value={block.href || ""}
              placeholder="https://youtube.com/watch?v=…"
              onChange={(event) => onChange({ href: event.target.value })}
            />
            {(() => {
              const resolved = resolveCampaignVideo(block.href);
              if (!block.href?.trim()) {
                return (
                  <p className="text-[9.5px] leading-4 text-muted-foreground">
                    YouTube, Vimeo, or a direct .mp4 / .webm / .mov link.
                  </p>
                );
              }
              return resolved ? (
                <p className="flex items-center gap-1 text-[9.5px] text-emerald-600">
                  <Check className="h-3 w-3" />
                  {resolved.provider === "file"
                    ? "Direct video file"
                    : `${resolved.provider === "youtube" ? "YouTube" : "Vimeo"} video detected`}
                </p>
              ) : (
                <p className="text-[9.5px] leading-4 text-amber-600">
                  Not recognised as a video. Use a YouTube or Vimeo link, or a
                  direct .mp4 / .webm / .mov URL.
                </p>
              );
            })()}
          </div>
          <MediaSourceField
            label="Poster frame"
            value={block.posterSrc || ""}
            error={imageError}
            uploading={imageUploading}
            accept={EMAIL_IMAGE_ACCEPT}
            onUpload={(file) => uploadImage(file, "posterSrc")}
            onUrlChange={(posterSrc) => {
              setImageError("");
              onChange({ posterSrc });
            }}
          />
          <p className="text-[9.5px] leading-4 text-muted-foreground">
            The builder plays the video. Inboxes cannot, so the sent email shows
            this poster and links out — YouTube's own thumbnail is used if you
            do not set one.
          </p>
        </div>
      ) : null}

      {block.type === "event_details" ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="block-event-starts">Starts</Label>
            <Input
              id="block-event-starts"
              type="datetime-local"
              value={toLocalInputValue(block.eventStartsAt)}
              onChange={(event) =>
                onChange({
                  eventStartsAt: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : "",
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="block-event-location">Location</Label>
            <Input
              id="block-event-location"
              value={block.eventLocation || ""}
              onChange={(event) =>
                onChange({ eventLocation: event.target.value })
              }
            />
          </div>
        </>
      ) : null}

      {block.type === "html" ? (
        <div className="space-y-1.5">
          <Label htmlFor="block-html">HTML</Label>
          <Textarea
            id="block-html"
            rows={6}
            value={block.html || ""}
            onChange={(event) => onChange({ html: event.target.value })}
            className="font-mono text-[11px]"
          />
          <p className="text-[9.5px] leading-4 text-muted-foreground">
            Rendered as-is. Scripts and styles are stripped on export, because
            no inbox runs them.
          </p>
        </div>
      ) : null}

      {block.type === "logo" ? (
        <MediaSourceField
          label="Logo"
          value={block.src || ""}
          error={imageError}
          uploading={imageUploading}
          accept={EMAIL_IMAGE_ACCEPT}
          onUpload={uploadImage}
          onUrlChange={(src) => {
            setImageError("");
            onChange({ src });
          }}
        />
      ) : null}

      {block.type === "image_gallery" ? (
        <div className="space-y-1.5">
          <Label htmlFor="block-gallery-urls">Image URLs</Label>
          <Textarea
            id="block-gallery-urls"
            rows={4}
            value={(block.items || []).map((item) => item.imageSrc).join("\n")}
            placeholder="https://"
            onChange={(event) =>
              onChange({
                items: event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((imageSrc, index) => ({
                    id: `gallery-${index}`,
                    title: "",
                    price: "",
                    imageSrc,
                    href: "",
                  })),
              })
            }
            className="text-[11px]"
          />
          <p className="text-[9.5px] leading-4 text-muted-foreground">
            One URL per line. Galleries are linked rather than uploaded, since
            several inline images would push the message past most size limits.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A text input cannot host styled tokens, so anything holding merge variables
 * gets this line underneath: the same string with each variable shown as it
 * will read once the send fills it in.
 */
function VariableHint({ value }: { value: string }) {
  if (!hasVariables(value)) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-1 text-[10px] leading-4 text-muted-foreground">
      <span className="shrink-0">Reads as</span>
      <VariableText value={value} className="text-foreground" />
    </p>
  );
}

export function CampaignBuilder({
  design,
  onDesignChange,
  onPreviewTextChange,
  onSendTest,
  onSubjectChange,
  mailingAddress,
  previewText,
  products,
  subject,
  immersive = false,
  device: controlledDevice,
  onDeviceChange,
  theme: providedTheme,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}: {
  design: CampaignDesign;
  onDesignChange: (design: CampaignDesign) => void;
  onPreviewTextChange: (value: string) => void;
  onSendTest?: () => void;
  onSubjectChange: (value: string) => void;
  mailingAddress: string;
  previewText: string;
  products: PaymentProduct[];
  subject: string;
  /**
   * Immersive mode is the full-screen stage: the canvas takes the whole width
   * and both side panels become overlays that appear only while adding or
   * editing a block.
   */
  immersive?: boolean;
  device?: CampaignPreviewDevice;
  onDeviceChange?: (device: CampaignPreviewDevice) => void;
  theme?: CampaignPreviewTheme;
  /** History is owned by the host, which also owns the design. */
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const theme: CampaignPreviewTheme =
    providedTheme ?? (resolvedTheme === "dark" ? "dark" : "light");
  // Nothing is selected on open. Auto-selecting the first block would put an
  // arbitrary block's settings in front of someone who has not chosen one, and
  // hide the campaign-level settings the panel otherwise shows.
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [internalDevice, setInternalDevice] =
    useState<CampaignPreviewDevice>("desktop");
  const device = controlledDevice ?? internalDevice;
  const setDevice = (value: CampaignPreviewDevice) => {
    setInternalDevice(value);
    onDeviceChange?.(value);
  };
  // Which tab the right-hand settings panel is on. Picking a block returns it
  // to Details, because that is what you want first for a block you just chose.
  const [settingsTab, setSettingsTab] = useState<
    "details" | "design" | "advanced"
  >("details");
  const selectBlock = (id: string | null) => {
    setSelectedBlockId(id);
    if (id) setSettingsTab("details");
  };
  // Toggles the canvas between editing chrome and a clean render of the email.
  const [previewing, setPreviewing] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Ctrl/Cmd+Z and Ctrl+Shift+Z (or Ctrl+Y) drive the host's history.
  //
  // Scoped to the builder: the key press only counts when it came from inside
  // this component (or from the bare page while the builder is the thing on
  // screen). It never reaches the rest of the app.
  //
  // A text field has its own undo stack that users expect to work, so while the
  // caret is in one — including the contentEditable canvas blocks — the event is
  // left to the browser rather than rewound to a whole earlier design.
  useEffect(() => {
    if (!onUndo && !onRedo) return;
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      const root = rootRef.current;
      const inBuilder =
        !target ||
        target === document.body ||
        target === document.documentElement ||
        Boolean(root && root.contains(target));
      if (!inBuilder) return;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "")
      ) {
        return;
      }
      const redoing = key === "y" || event.shiftKey;
      if (redoing ? !onRedo : !onUndo) return;
      event.preventDefault();
      if (redoing) onRedo?.();
      else onUndo?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onRedo, onUndo]);

  const container = design.container || {};
  const patchContainer = (patch: Partial<typeof container>) =>
    onDesignChange({ ...design, container: { ...container, ...patch } });

  // Where an inline "+" wants a new block. Null means the picker is closed.
  const [insertAt, setInsertAt] = useState<number | null>(null);

  const selectedIndex = design.blocks.findIndex(
    (block) => block.id === selectedBlockId,
  );
  const selectedBlock = selectedIndex >= 0 ? design.blocks[selectedIndex] : null;

  const addBlock = (type: CampaignBlockType, index = design.blocks.length) => {
    const block = createCampaignBlock(type);
    if (type === "compliance_footer" && mailingAddress) {
      block.mailingAddress = mailingAddress;
    }
    const blocks = [...design.blocks];
    blocks.splice(index, 0, block);
    onDesignChange({ ...design, blocks });
    // Adding a block — by click or by drop — is immediately followed by wanting
    // to edit it, so selecting it turns the column over to its settings.
    selectBlock(block.id);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, index: number) => {
    event.preventDefault();
    const type = event.dataTransfer.getData(DRAG_NEW_BLOCK) as CampaignBlockType;
    if (type) {
      addBlock(type, index);
      return;
    }
    const movedId = event.dataTransfer.getData(DRAG_MOVE_BLOCK);
    if (!movedId) return;
    const sourceIndex = design.blocks.findIndex(
      (block) => block.id === movedId,
    );
    if (sourceIndex < 0) return;
    const blocks = [...design.blocks];
    const [moved] = blocks.splice(sourceIndex, 1);
    blocks.splice(sourceIndex < index ? index - 1 : index, 0, moved);
    onDesignChange({ ...design, blocks });
  };

  const updateSelected = (patch: Partial<CampaignBlock>) =>
    onDesignChange({
      ...design,
      blocks: design.blocks.map((block) =>
        block.id === selectedBlockId ? { ...block, ...patch } : block,
      ),
    });

  const moveSelected = (offset: number) => {
    const target = selectedIndex + offset;
    if (selectedIndex < 0 || target < 0 || target >= design.blocks.length) {
      return;
    }
    const blocks = [...design.blocks];
    [blocks[selectedIndex], blocks[target]] = [
      blocks[target],
      blocks[selectedIndex],
    ];
    onDesignChange({ ...design, blocks });
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        immersive
          ? "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden md:grid-cols-[236px_minmax(0,1fr)] xl:grid-cols-[236px_minmax(0,1fr)_320px]"
          : "grid min-h-[560px] overflow-hidden rounded-xl border border-border xl:grid-cols-[196px_minmax(0,1fr)_324px]",
      )}
    >
      {/* Left: the block library. Always in reach, never covering the canvas. */}
      <aside
        aria-label="Blocks"
        className={cn(
          immersive
            ? "dashboard-scroll flex min-h-0 flex-col overflow-y-auto overscroll-contain border-r border-border bg-card px-2.5 py-3"
            : "dashboard-scroll hidden min-h-0 max-h-[calc(100dvh-260px)] overflow-y-auto overscroll-contain border-r border-border px-3 py-5 xl:block",
        )}
      >
        <BlockPalette onAdd={addBlock} compact={!immersive} />
      </aside>

      <div className={cn("min-w-0", immersive && "flex min-h-0 flex-col")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {immersive ? (
              <>
                {/* Nobody discovers "click the empty space" on their own, so
                    editing the whole email is an explicit button. */}
                <Button
                  type="button"
                  size="sm"
                  variant={selectedBlock ? "outline" : "default"}
                  className="h-7 text-[11px]"
                  aria-pressed={!selectedBlock}
                  onClick={() => selectBlock(null)}
                >
                  <Frame className="h-3.5 w-3.5" />
                  Email settings
                </Button>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {design.blocks.length}{" "}
                  {design.blocks.length === 1 ? "block" : "blocks"}
                </span>
                {onUndo || onRedo ? (
                  <div className="ml-1 flex items-center gap-0.5 border-l border-border pl-1.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={!canUndo}
                      onClick={onUndo}
                      title="Undo (Ctrl+Z)"
                      aria-label="Undo"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={!canRedo}
                      onClick={onRedo}
                      title="Redo (Ctrl+Shift+Z)"
                      aria-label="Redo"
                    >
                      <Redo2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <span className="text-[11px] font-semibold">Live canvas</span>
                <Badge variant="outline" className="text-[9px]">
                  600 px email width
                </Badge>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {immersive ? (
              // The canvas carries editing chrome, which is not what lands in
              // the inbox. Preview drops all of it and renders the email
              // exactly as composed, without leaving the builder.
              <div className="flex rounded-md border border-border p-0.5">
                {(
                  [
                    [false, "Edit"],
                    [true, "Preview"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setPreviewing(value)}
                    aria-pressed={previewing === value}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors",
                      previewing === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {value ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <Pencil className="h-3.5 w-3.5" />
                    )}
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            {immersive ? null : (
              <div className="flex rounded-md border border-border p-0.5">
                {(
                  [
                    ["desktop", Monitor],
                    ["tablet", Tablet],
                    ["mobile", Smartphone],
                  ] as const
                ).map(([value, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDevice(value)}
                    aria-label={`${value} preview`}
                    aria-pressed={device === value}
                    className={cn(
                      "flex h-7 w-8 items-center justify-center rounded",
                      device === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            )}
            {onSendTest ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onSendTest}
              >
                <Send className="h-3.5 w-3.5" />
                Send test
              </Button>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            "dashboard-scroll overflow-y-auto overscroll-contain",
            immersive
              ? "min-h-0 flex-1 px-4 py-4"
              : "max-h-[calc(100dvh-300px)] min-h-[440px] bg-muted/20 px-4 py-5",
            // The canvas surface, not the app chrome, is what switches: the
            // preview is simulating the recipient's inbox, not the dashboard.
            immersive && theme === "dark" ? "bg-[#0e1013]" : "",
            immersive && theme === "light" ? "bg-muted/30" : "",
          )}
        >
          {/* The email is a fixed width by nature, so the sheet is framed
              rather than stretched — an inbox-sized page on a work surface,
              not a narrow column adrift in empty space. */}
          {immersive && previewing ? (
            <div
              className="mx-auto w-fit"
              aria-label="Campaign preview"
              role="region"
            >
              <CampaignPreview
                design={design}
                width={
                  device === "mobile" ? 360 : device === "tablet" ? 480 : 600
                }
                breakpoint={device}
              />
            </div>
          ) : (
          <div
            // Clicking the sheet but not a block selects the campaign
            // container, which is what the settings panel then edits.
            onClick={(event) => {
              if (event.target === event.currentTarget) selectBlock(null);
            }}
            className={cn(
              "mx-auto",
              immersive &&
                "overflow-hidden rounded-lg border border-border/60 shadow-xs",
            )}
            style={{
              maxWidth:
                device === "mobile"
                  ? 400
                  : device === "tablet"
                    ? 560
                    : immersive
                      ? 680
                      : 640,
              backgroundColor: immersive
                ? campaignColor(design.cardBackground, "#FFFFFF")
                : undefined,
              padding: immersive ? (container.contentPadding ?? 28) : undefined,
            }}
          >
            <InsertPoint
              onInsert={() => setInsertAt(0)}
              onDrop={(event) => handleDrop(event, 0)}
            />
            {design.blocks.map((block, index) => (
              <div key={block.id}>
                <CanvasBlock
                  accent={campaignColor(design.accent, "#635BFF")}
                  block={block}
                  index={index}
                  breakpoint={device}
                  selected={block.id === selectedBlockId}
                  total={design.blocks.length}
                  onContentChange={(content) =>
                    onDesignChange({
                      ...design,
                      blocks: design.blocks.map((candidate) =>
                        candidate.id === block.id
                          ? { ...candidate, content }
                          : candidate,
                      ),
                    })
                  }
                  onSelect={() => selectBlock(block.id)}
                  onDuplicate={() => {
                    const copy = {
                      ...block,
                      id: `${block.type}-${Date.now()}-${Math.random()
                        .toString(36)
                        .slice(2, 7)}`,
                    };
                    const blocks = [...design.blocks];
                    blocks.splice(index + 1, 0, copy);
                    onDesignChange({ ...design, blocks });
                    selectBlock(copy.id);
                  }}
                  onDelete={() => {
                    onDesignChange({
                      ...design,
                      blocks: design.blocks.filter(
                        (entry) => entry.id !== block.id,
                      ),
                    });
                    if (selectedBlockId === block.id) setSelectedBlockId(null);
                  }}
                />
                <InsertPoint
                  onInsert={() => setInsertAt(index + 1)}
                  onDrop={(event) => handleDrop(event, index + 1)}
                />
              </div>
            ))}
            {!design.blocks.length ? (
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDrop(event, 0)}
                className="flex min-h-[260px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-background text-center"
              >
                <LayoutTemplate className="h-5 w-5 text-primary" />
                <p className="mt-3 text-[13px] font-medium">
                  Start with a block
                </p>
                <p className="mt-1 max-w-[280px] text-[11px] leading-5 text-muted-foreground">
                  Drag one in from the palette, or open the Templates tab to
                  start from a finished layout.
                </p>
              </div>
            ) : null}
          </div>
          )}
        </div>
      </div>

      {/* The inline "+" opens the same library the palette shows, inserting at
          the point that was clicked rather than at the end. */}
      <Dialog
        open={insertAt !== null}
        onOpenChange={(open) => {
          if (!open) setInsertAt(null);
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Add a block</DialogTitle>
          </DialogHeader>
          <BlockPalette
            onAdd={(type) => {
              addBlock(type, insertAt ?? design.blocks.length);
              setInsertAt(null);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Right: settings for whatever is selected, split the way an editor of
          this kind is expected to split — what it says, how it looks, and the
          escape hatches. The panel is only rendered in one layout at a time so
          its form controls can never duplicate ids. */}
      {immersive ? (
        <aside
          aria-label="Block settings"
          className="hidden min-h-0 flex-col border-l border-border bg-card xl:flex"
        >
          <div
            role="tablist"
            aria-label="Block settings tabs"
            className="flex shrink-0 gap-0.5 border-b border-border p-1.5"
          >
            {(
              [
                ["details", "Details"],
                ["design", "Design"],
                ["advanced", "Advanced"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                // Always enabled: with nothing selected these tabs edit the
                // campaign container, which has the same three concerns.
                aria-selected={settingsTab === value}
                onClick={() => setSettingsTab(value)}
                className={cn(
                  "h-8 flex-1 rounded-md text-[11.5px] font-medium transition-colors disabled:opacity-40",
                  settingsTab === value
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="dashboard-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
            {selectedBlock ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold">
                      {campaignBlockLabels[selectedBlock.type]}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Block {selectedIndex + 1} of {design.blocks.length}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={selectedIndex <= 0}
                      aria-label="Move block up"
                      onClick={() => moveSelected(-1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={selectedIndex >= design.blocks.length - 1}
                      aria-label="Move block down"
                      onClick={() => moveSelected(1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {settingsTab === "details" ? (
                  <BlockProperties
                    block={selectedBlock}
                    mailingAddress={mailingAddress}
                    onChange={updateSelected}
                    products={products}
                  />
                ) : null}
                {settingsTab === "design" ? (
                  <BlockDesignPanel
                    block={selectedBlock}
                    design={design}
                    onChange={updateSelected}
                  />
                ) : null}
                {settingsTab === "advanced" ? (
                  <BlockAdvancedPanel
                    block={selectedBlock}
                    onChange={updateSelected}
                  />
                ) : null}
              </div>
            ) : (
              // Nothing selected means the campaign container itself is what is
              // being edited � the sheet the blocks sit inside. Subject and
              // preview line are not here: they live above the canvas, because
              // they describe the inbox listing rather than the design.
              <div className="space-y-3">
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
                  <p className="text-[11.5px] font-semibold text-primary">
                    Campaign container
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-4 text-muted-foreground">
                    The whole email. Pick a block on the canvas to edit just
                    that block.
                  </p>
                </div>
                <ContainerPanel
                  tab={settingsTab}
                  design={design}
                  onDesignChange={onDesignChange}
                />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border p-2.5">
            <SpamScorePanel
              design={design}
              previewText={previewText}
              subject={subject}
            />
          </div>
        </aside>
      ) : null}

      {immersive ? null : (
        <aside className="dashboard-scroll min-h-0 max-h-[calc(100dvh-260px)] overflow-y-auto overscroll-contain border-t border-border bg-card p-4 xl:border-l xl:border-t-0">
        <div className="space-y-4">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Message
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-builder-subject">Subject line</Label>
              <Input
                id="campaign-builder-subject"
                value={subject}
                onChange={(event) => onSubjectChange(event.target.value)}
                placeholder="48 hours: 20% off everything"
              />
              <p className="text-[10px] text-muted-foreground">
                {subject.trim().length} characters. Most inboxes clip near 60.
              </p>
              <VariableHint value={subject} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-builder-preheader">Preheader</Label>
              <Input
                id="campaign-builder-preheader"
                value={previewText}
                onChange={(event) => onPreviewTextChange(event.target.value)}
                placeholder="Shown beside the subject in supported inboxes"
              />
              <VariableHint value={previewText} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 border-y border-border py-4">
            {(
              [
                ["accent", "Accent", "#635BFF"],
                ["pageBackground", "Page", "#F5F7FB"],
                ["cardBackground", "Card", "#FFFFFF"],
              ] as const
            ).map(([key, label, fallback]) => (
              <label key={key} className="space-y-1 text-[10px] text-muted-foreground">
                {label}
                <input
                  aria-label={`${label} color`}
                  className="mt-1 h-8 w-full cursor-pointer rounded border border-border bg-transparent p-0.5"
                  type="color"
                  value={campaignColor(design[key], fallback)}
                  onChange={(event) =>
                    onDesignChange({ ...design, [key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>

          {selectedBlock ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[12px] font-semibold">
                    {campaignBlockLabels[selectedBlock.type]}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Block {selectedIndex + 1} of {design.blocks.length}
                  </p>
                </div>
                <div className="flex gap-0.5">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={selectedIndex <= 0}
                    aria-label="Move block up"
                    onClick={() => moveSelected(-1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={selectedIndex >= design.blocks.length - 1}
                    aria-label="Move block down"
                    onClick={() => moveSelected(1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <BlockProperties
                block={selectedBlock}
                mailingAddress={mailingAddress}
                onChange={updateSelected}
                products={products}
              />
            </section>
          ) : (
            <p className="text-[11px] leading-5 text-muted-foreground">
              Select a block on the canvas to edit its content and layout.
            </p>
          )}

          <SpamScorePanel
            design={design}
            previewText={previewText}
            subject={subject}
          />
        </div>
        </aside>
      )}
    </div>
  );
}

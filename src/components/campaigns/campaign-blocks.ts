/**
 * Campaign block model.
 *
 * Structurally identical to the block model the Email Templates builder writes
 * into `email_templates.blocks`, extended with the blocks a marketer needs. A
 * campaign design is stored as a single `campaign_design` envelope block so the
 * same reader handles a campaign and a transactional template.
 */

/**
 * The four standard alignments, available on every block rather than the
 * left/centre pair the marketing blocks originally shipped with.
 */
export type CampaignAlign = "left" | "center" | "right" | "justify";

export const campaignAlignments: Array<{
  value: CampaignAlign;
  label: string;
}> = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

/** Preview surfaces the builder can render the same design against. */
export type CampaignPreviewDevice = "desktop" | "tablet" | "mobile";

/**
 * Which colour scheme the preview simulates. Whether a real inbox renders in
 * dark mode is the recipient's client and OS setting — this only shows how the
 * current design would look under each, so a logo that vanishes on a dark
 * background is caught before the send rather than after a complaint.
 */
export type CampaignPreviewTheme = "light" | "dark";

export type CampaignBlockType =
  | "label"
  | "heading"
  | "text"
  | "list"
  | "quote"
  | "button"
  | "button_group"
  | "image"
  | "image_gallery"
  | "video"
  | "logo"
  | "divider"
  | "spacer"
  | "columns"
  | "hero"
  | "product_grid"
  | "coupon"
  | "order_summary"
  | "countdown"
  | "social"
  | "menu"
  | "testimonial"
  | "stats"
  | "feature_list"
  | "cta_banner"
  | "rating"
  | "event_details"
  | "event_ticket"
  | "event_access"
  | "calendar_links"
  | "html"
  | "form"
  | "compliance_footer";

/**
 * Per-side box values, in pixels. Named rather than a shorthand string so the
 * four inputs in the Design tab map one-to-one onto what gets rendered.
 */
export type CampaignBoxSpacing = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * The wrapper a block sits in — the strip across the email, not the thing
 * inside it.
 *
 * Kept as its own object because the two layers answer different questions.
 * "Put a border on this button" means the button; "put a band behind this
 * section" means the wrapper. Collapsing them into one set of properties is
 * what made a button's border draw around the whole block.
 */
export type CampaignBlockContainer = {
  backgroundColor?: string;
  gradient?: { from: string; to: string; angle: number };
  backgroundImage?: string;
  backgroundSize?: "cover" | "contain" | "auto";
  backgroundPosition?: "center" | "top" | "bottom" | "left" | "right";
  padding?: CampaignBoxSpacing;
  margin?: CampaignBoxSpacing;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  borderColor?: string;
  borderRadius?: number;
  /** How the element sits inside the wrapper. */
  align?: CampaignAlign;
  /** Caps the wrapper's width, in pixels. */
  maxWidth?: number;
  shadow?: "none" | "sm" | "md" | "lg";
  opacity?: number;
};

/**
 * The element inside the block — the button itself, the heading itself, the
 * image itself. Everything here lands on that element, never on the wrapper.
 *
 * All values are optional: a block with no design overrides renders from the
 * campaign's own palette and the type's defaults, which is what keeps a
 * newly dropped block looking right without anyone touching this tab.
 */
export type CampaignBlockDesign = {
  /** The wrapper's own styling. */
  container?: CampaignBlockContainer;
  textColor?: string;
  /**
   * The band behind the whole block, edge to edge.
   *
   * Deliberately distinct from `elementBackground`: colouring a button's block
   * background paints the strip the button sits on, which is almost never what
   * someone means when they say "make the button green".
   */
  backgroundColor?: string;
  /**
   * The fill of the thing itself — the button, the coupon chip, the banner —
   * for blocks that have a distinct element inside their band.
   */
  elementBackground?: string;
  fontFamily?: string;
  /** Pixels. */
  fontSize?: number;
  fontWeight?: 300 | 400 | 500 | 600 | 700 | 800;
  /** Unitless multiplier, e.g. 1.5. */
  lineHeight?: number;
  /** Pixels, can be negative for tighter display type. */
  letterSpacing?: number;
  textTransform?: "none" | "uppercase" | "capitalize";
  /** Overrides the block's own text alignment when set. */
  textAlign?: CampaignAlign;
  padding?: CampaignBoxSpacing;
  margin?: CampaignBoxSpacing;
  /** Border on the element — the button's own outline, not the block's. */
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  borderColor?: string;
  borderRadius?: number;
  /** Inner spacing of the element itself, e.g. a button's hit area. */
  elementPadding?: CampaignBoxSpacing;
  /** Fixed element dimensions, in pixels. */
  width?: number;
  height?: number;
  objectFit?: "cover" | "contain" | "fill";

  /** 0-100. Below 100 the element is see-through. */
  opacity?: number;
  shadow?: "none" | "sm" | "md" | "lg";
  /** Applies on hover in the builder; most inboxes ignore :hover entirely. */
  hoverTextColor?: string;
  hoverBackgroundColor?: string;

  /**
   * Overrides for narrower screens. Only the properties that differ are
   * stored, so a block sized once still renders everywhere.
   */
  tablet?: CampaignResponsiveDesign;
  mobile?: CampaignResponsiveDesign;
};

/** The subset worth varying per screen — mostly size and spacing. */
export type CampaignResponsiveDesign = {
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: CampaignAlign;
  padding?: CampaignBoxSpacing;
  margin?: CampaignBoxSpacing;
};

export type CampaignBreakpoint = "desktop" | "tablet" | "mobile";

/** Escape hatches for people who know exactly what they want. */
export type CampaignBlockAdvanced = {
  /** Rendered as the element's id, for anchor links. */
  htmlId?: string;
  cssClass?: string;
  /** Hidden below 480px via a media query in the exported HTML. */
  hideOnMobile?: boolean;
  /** Hidden at desktop widths. */
  hideOnDesktop?: boolean;
  /** Extra inline CSS appended last, so it wins over the Design tab. */
  customCss?: string;
};

export type CampaignProductItem = {
  id: string;
  title: string;
  price: string;
  imageSrc: string;
  href: string;
};

export type CampaignSocialItem = {
  id: string;
  network: "website" | "instagram" | "linkedin" | "x" | "facebook" | "youtube";
  href: string;
};

export type CampaignBlock = {
  id: string;
  type: CampaignBlockType;
  content?: string;
  subtext?: string;
  buttonLabel?: string;
  href?: string;
  alt?: string;
  src?: string;
  align?: CampaignAlign;
  size?: "small" | "medium" | "large";
  height?: number;
  /** Hero overlay strength, 0-80. */
  overlay?: number;
  /** Product / ticket grid source and selection. */
  sourceType?: "catalog" | "tickets";
  columns?: 1 | 2 | 3;
  items?: CampaignProductItem[];
  socials?: CampaignSocialItem[];
  /** Countdown target as an ISO instant. */
  deadline?: string;
  attribution?: string;
  /** Compliance footer fields. */
  mailingAddress?: string;
  unsubscribeLabel?: string;
  /** Bullet or numbered list entries. */
  listItems?: string[];
  listStyle?: "bullet" | "number" | "check";
  /** Stats, feature rows, and menu links all carry label/value pairs. */
  entries?: Array<{ id: string; label: string; value: string; href?: string }>;
  /** Coupon block. */
  couponCode?: string;
  /** Rating block, 0-5. */
  rating?: number;
  /** Video block: the poster frame links out, since inboxes cannot play video. */
  posterSrc?: string;
  /** Raw HTML block. */
  html?: string;
  /** Event details block. */
  eventStartsAt?: string;
  eventLocation?: string;
  design?: CampaignBlockDesign;
  advanced?: CampaignBlockAdvanced;
};

/**
 * The container the blocks sit inside — the sheet itself, its header band, and
 * the footer line. Editable so a campaign is not stuck with the default
 * accent stripe and rounded card.
 */
export type CampaignContainer = {
  /** Shown in the header band above the content. */
  headerTitle?: string;
  /** An emoji or short mark rendered beside the header title. */
  headerIcon?: string;
  headerBackground?: string;
  headerTextColor?: string;
  /**
   * The stripe's own colour. Kept separate from design.accent so restyling the
   * container's trim does not repaint every button, eyebrow and link in the
   * body — those follow the campaign accent, which is a different decision.
   */
  stripeColor?: string;
  /** 0 hides the stripe entirely. */
  stripeHeight?: number;
  /** Sheet corner radius, in pixels. */
  cornerRadius?: number;
  /** Inner padding of the content area, in pixels. */
  contentPadding?: number;
  /** Sheet width in pixels; email convention is 600. */
  width?: number;
  fontFamily?: string;
};

/**
 * Document-wide type settings.
 *
 * Separate from a block's own styling: these are the defaults every paragraph
 * and heading inherits, which is what a text-only email has instead of
 * per-block controls.
 */
export type CampaignTypography = {
  linkColor?: string;
  fontFamily?: string;
  fontSize?: number;
  headingOneFamily?: string;
  headingOneSize?: number;
  headingTwoFamily?: string;
  headingTwoSize?: number;
  headingThreeFamily?: string;
  headingThreeSize?: number;
  /** Language of the preview header and unsubscribe line. */
  language?: string;
};

export const defaultCampaignTypography: Required<CampaignTypography> = {
  linkColor: "#635BFF",
  fontFamily: "Inter, Arial, sans-serif",
  fontSize: 16,
  headingOneFamily: "",
  headingOneSize: 30,
  headingTwoFamily: "",
  headingTwoSize: 24,
  headingThreeFamily: "",
  headingThreeSize: 18,
  language: "en",
};

/** Fonts that render without a web font download in most email clients. */
export const emailSafeFonts: Array<{ value: string; label: string }> = [
  { value: "Inter, Arial, sans-serif", label: "Inter (falls back to Arial)" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Helvetica, Arial, sans-serif", label: "Helvetica" },
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { value: "Tahoma, Verdana, sans-serif", label: "Tahoma" },
  { value: "'Trebuchet MS', Tahoma, sans-serif", label: "Trebuchet MS" },
  { value: "'Courier New', Courier, monospace", label: "Courier New" },
];

export const campaignLanguages: Array<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
];

export const resolveTypography = (
  typography?: CampaignTypography,
): Required<CampaignTypography> => ({
  ...defaultCampaignTypography,
  ...Object.fromEntries(
    Object.entries(typography || {}).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  ),
});

export type CampaignDesign = {
  accent: string;
  pageBackground: string;
  cardBackground: string;
  footerText: string;
  container?: CampaignContainer;
  typography?: CampaignTypography;
  /** Preserves the authoring surface used when this campaign was designed. */
  authoringMode?: "builder" | "plain_text" | "custom_html";
  blocks: CampaignBlock[];
};

export const campaignBlockLabels: Record<CampaignBlockType, string> = {
  label: "Eyebrow",
  heading: "Heading",
  text: "Paragraph",
  list: "List",
  quote: "Pull quote",
  button: "Button",
  button_group: "Button row",
  image: "Image",
  image_gallery: "Gallery",
  video: "Video",
  logo: "Logo",
  divider: "Divider",
  spacer: "Spacer",
  columns: "Columns",
  hero: "Hero banner",
  product_grid: "Products",
  coupon: "Coupon code",
  order_summary: "Order summary",
  countdown: "Countdown",
  social: "Social row",
  menu: "Menu links",
  testimonial: "Testimonial",
  stats: "Stats",
  feature_list: "Feature list",
  cta_banner: "CTA banner",
  rating: "Star rating",
  event_details: "Event details",
  event_ticket: "Event ticket",
  event_access: "Online access",
  calendar_links: "Calendar links",
  html: "Custom HTML",
  form: "Signup form",
  compliance_footer: "Footer",
};

export const campaignBlockGroups: Array<{
  group: string;
  types: CampaignBlockType[];
}> = [
  {
    group: "Text",
    types: ["heading", "text", "label", "list", "quote"],
  },
  {
    group: "Media",
    types: ["image", "image_gallery", "video", "logo"],
  },
  {
    group: "Layout",
    types: ["divider", "spacer", "columns"],
  },
  {
    group: "Actions",
    types: ["button", "button_group", "menu", "social"],
  },
  {
    group: "Commerce",
    types: ["product_grid", "coupon", "order_summary", "event_details", "event_ticket", "event_access", "calendar_links"],
  },
  {
    group: "Marketing",
    types: [
      "hero",
      "cta_banner",
      "countdown",
      "stats",
      "feature_list",
      "testimonial",
      "rating",
    ],
  },
  {
    group: "Advanced",
    types: ["form", "html", "compliance_footer"],
  },
];

export const campaignBlockDescriptions: Record<CampaignBlockType, string> = {
  label: "Small uppercase kicker above a heading.",
  heading: "The main line of the section.",
  text: "A paragraph of body copy.",
  list: "Bulleted, numbered, or ticked points.",
  quote: "A short line set apart from the body.",
  button: "A single call to action.",
  button_group: "Two or more actions side by side.",
  image: "An uploaded image, centred or left.",
  image_gallery: "Two or three images in a row.",
  video: "A poster frame that links to the video.",
  logo: "Your workspace logo, centred.",
  divider: "A thin rule between sections.",
  spacer: "Vertical breathing room.",
  columns: "Two columns of text side by side.",
  hero: "Background image with heading, subtext, and a button.",
  product_grid: "Live products or ticket types from your catalog.",
  coupon: "A discount code the reader can copy.",
  order_summary: "Line items and a total.",
  countdown: "Server-rendered time remaining as an image.",
  social: "A row of links to your profiles.",
  menu: "A row of text links, like a nav bar.",
  testimonial: "A quote with attribution.",
  stats: "Two or three numbers worth showing off.",
  feature_list: "Short benefit rows with titles and detail.",
  cta_banner: "A full-width band with one action.",
  rating: "Star rating with a caption.",
  event_details: "Date, time and location for an event.",
  event_ticket: "Dynamic ticket type, number, and secure ticket action.",
  event_access: "Shows a protected attendee meeting link only for online events.",
  calendar_links: "Adds provider-aware calendar links for the attendee.",
  html: "Raw HTML for anything not covered above.",
  form: "An email-safe signup form that posts to one of your forms.",
  compliance_footer: "Unsubscribe link and mailing address. Required to send.",
};

/** Extra terms the palette search should match beyond the label itself. */
export const campaignBlockKeywords: Record<CampaignBlockType, string> = {
  label: "eyebrow kicker tag pretitle small caps",
  heading: "title h1 h2 headline",
  text: "paragraph body copy content",
  list: "bullet points numbered ticks checklist",
  quote: "pullquote blockquote callout",
  button: "cta call to action link",
  button_group: "buttons actions pair row cta",
  image: "picture photo graphic banner",
  image_gallery: "images photos grid row",
  video: "youtube vimeo play film",
  logo: "brand mark identity",
  divider: "rule line separator hr",
  spacer: "gap space padding blank",
  columns: "two column split side by side layout",
  hero: "banner cover masthead header splash",
  product_grid: "shop store catalog tickets items merchandise",
  coupon: "discount promo code voucher offer",
  order_summary: "receipt invoice total line items",
  countdown: "timer deadline urgency clock",
  social: "instagram linkedin facebook x youtube follow",
  menu: "nav navigation links bar",
  testimonial: "review quote customer praise",
  stats: "numbers metrics kpi figures",
  feature_list: "benefits features perks bullets icons",
  cta_banner: "band strip callout action",
  rating: "stars score review",
  event_details: "date time venue location when where",
  event_ticket: "ticket type number code attendee admission",
  event_access: "online meeting join link meet teams zoom access",
  calendar_links: "calendar google outlook ics add event schedule",
  html: "code custom raw embed",
  form: "signup subscribe input field capture lead",
  compliance_footer: "unsubscribe address legal can-spam",
};

const blockId = () =>
  crypto.randomUUID?.() ||
  `campaign-block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Ids for repeatable rows inside a block (menu links, stats, features). */
const entryId = () =>
  `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const createCampaignEntry = (label = "", value = "") => ({
  id: entryId(),
  label,
  value,
});

export const createCampaignBlock = (
  type: CampaignBlockType,
): CampaignBlock => {
  const id = blockId();
  if (type === "label") {
    return { id, type, content: "Campaign update", align: "left" };
  }
  if (type === "heading") {
    return {
      id,
      type,
      content: "A headline worth opening for",
      align: "left",
      size: "large",
    };
  }
  if (type === "text") {
    return {
      id,
      type,
      content:
        "Say what changed and what the reader should do next. One clear idea per paragraph.",
      align: "left",
    };
  }
  if (type === "button") {
    return {
      id,
      type,
      content: "Shop the sale",
      href: "https://",
      align: "left",
    };
  }
  if (type === "image") {
    return { id, type, alt: "Campaign image", src: "", align: "center" };
  }
  if (type === "divider") return { id, type };
  if (type === "spacer") return { id, type, height: 24 };
  if (type === "hero") {
    return {
      id,
      type,
      content: "Summer sale is live",
      subtext: "20% off everything until Friday.",
      buttonLabel: "Shop the sale",
      href: "https://",
      src: "",
      overlay: 45,
      align: "center",
    };
  }
  if (type === "product_grid") {
    return { id, type, sourceType: "catalog", columns: 2, items: [] };
  }
  if (type === "countdown") {
    return {
      id,
      type,
      content: "Offer ends in",
      deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      align: "center",
    };
  }
  if (type === "social") {
    return {
      id,
      type,
      align: "center",
      socials: [
        { id: blockId(), network: "website", href: "https://" },
        { id: blockId(), network: "instagram", href: "https://" },
      ],
    };
  }
  if (type === "testimonial") {
    return {
      id,
      type,
      content: "This is the only tool our team never argues about.",
      attribution: "Customer name, Company",
      align: "left",
    };
  }
  if (type === "list") {
    return {
      id,
      type,
      listStyle: "bullet",
      listItems: [
        "The first thing that changed",
        "The second thing that changed",
        "Why it matters to you",
      ],
      align: "left",
    };
  }
  if (type === "quote") {
    return {
      id,
      type,
      content: "One sentence worth pulling out of the paragraph.",
      align: "left",
    };
  }
  if (type === "button_group") {
    return {
      id,
      type,
      align: "left",
      entries: [
        { id: entryId(), label: "Shop the sale", value: "https://" },
        { id: entryId(), label: "See what's new", value: "https://" },
      ],
    };
  }
  if (type === "image_gallery") {
    return {
      id,
      type,
      columns: 3,
      items: [],
      align: "center",
    };
  }
  if (type === "video") {
    return {
      id,
      type,
      content: "Watch the 2-minute tour",
      href: "https://",
      posterSrc: "",
      align: "center",
    };
  }
  if (type === "logo") {
    return { id, type, src: "", alt: "Logo", align: "center", height: 40 };
  }
  if (type === "columns") {
    return {
      id,
      type,
      columns: 2,
      align: "left",
      entries: [
        { id: entryId(), label: "First column", value: "A short paragraph." },
        { id: entryId(), label: "Second column", value: "A short paragraph." },
      ],
    };
  }
  if (type === "coupon") {
    return {
      id,
      type,
      content: "Use this code at checkout",
      couponCode: "SAVE20",
      subtext: "Expires in 7 days",
      align: "center",
    };
  }
  if (type === "order_summary") {
    return {
      id,
      type,
      content: "Order summary",
      align: "left",
      entries: [
        { id: entryId(), label: "General admission x2", value: "$90.00" },
        { id: entryId(), label: "Booking fee", value: "$4.50" },
        { id: entryId(), label: "Total", value: "$94.50" },
      ],
    };
  }
  if (type === "menu") {
    return {
      id,
      type,
      align: "center",
      entries: [
        { id: entryId(), label: "Shop", value: "https://" },
        { id: entryId(), label: "About", value: "https://" },
        { id: entryId(), label: "Contact", value: "https://" },
      ],
    };
  }
  if (type === "stats") {
    return {
      id,
      type,
      columns: 3,
      align: "center",
      entries: [
        { id: entryId(), label: "Customers", value: "12,000" },
        { id: entryId(), label: "Countries", value: "38" },
        { id: entryId(), label: "Uptime", value: "99.9%" },
      ],
    };
  }
  if (type === "feature_list") {
    return {
      id,
      type,
      align: "left",
      entries: [
        {
          id: entryId(),
          label: "Set up in minutes",
          value: "No migration, no engineer, no long contract.",
        },
        {
          id: entryId(),
          label: "Everything in one place",
          value: "Forms, payments, and follow-up share the same records.",
        },
      ],
    };
  }
  if (type === "cta_banner") {
    return {
      id,
      type,
      content: "Ready when you are",
      subtext: "Start your first campaign today.",
      buttonLabel: "Get started",
      href: "https://",
      align: "center",
    };
  }
  if (type === "rating") {
    return {
      id,
      type,
      rating: 5,
      content: "Rated 4.9 out of 5 by 800+ customers",
      align: "center",
    };
  }
  if (type === "event_details") {
    return {
      id,
      type,
      content: "Event details",
      eventStartsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      eventLocation: "The Venue, Lagos",
      align: "left",
    };
  }
  if (type === "event_ticket") {
    return { id, type, content: "Your ticket", align: "left" };
  }
  if (type === "event_access") {
    return { id, type, content: "Join the event", align: "left" };
  }
  if (type === "calendar_links") {
    return { id, type, content: "Add to calendar", align: "left" };
  }
  if (type === "html") {
    return {
      id,
      type,
      html: "<p style=\"margin:0\">Your HTML here.</p>",
      align: "left",
    };
  }
  if (type === "form") {
    // An email cannot post a form — most clients strip <form> outright — so the
    // fields are a visual invitation and the button carries the real link.
    return {
      id,
      type,
      content: "Join the list",
      subtext: "No spam. Unsubscribe any time.",
      buttonLabel: "Subscribe",
      href: "https://",
      align: "left",
      entries: [
        createCampaignEntry("Email", "you@example.com"),
      ],
    };
  }
  return {
    id,
    type,
    unsubscribeLabel: "Unsubscribe",
    mailingAddress: "",
    align: "center",
  };
};

/* ------------------------------------------------------------------ *
 * Design and advanced property helpers.
 *
 * Both the canvas and the exported HTML render from these, so what the
 * Design tab shows is what lands in the inbox.
 * ------------------------------------------------------------------ */

export const emptyBoxSpacing = (): CampaignBoxSpacing => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

const boxValue = (value: unknown) => {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(-200, Math.min(400, parsed)) : 0;
};

export const normalizeBoxSpacing = (
  value: Partial<CampaignBoxSpacing> | undefined,
): CampaignBoxSpacing => ({
  top: boxValue(value?.top),
  right: boxValue(value?.right),
  bottom: boxValue(value?.bottom),
  left: boxValue(value?.left),
});

const hasSpacing = (value: CampaignBoxSpacing | undefined) =>
  Boolean(value) &&
  (value!.top !== 0 ||
    value!.right !== 0 ||
    value!.bottom !== 0 ||
    value!.left !== 0);

/**
 * Font stacks that survive an email client without a webfont request.
 *
 * Every entry ends in a generic family, so a client missing the first choice
 * still lands somewhere sensible rather than falling back to Times. Webfonts
 * are deliberately absent: Gmail and Outlook strip @font-face, so offering one
 * would promise a face most recipients would never see.
 */
export const campaignFontFamilies = [
  { value: "", label: "Match campaign", category: "Default" },
  // Sans
  { value: "Arial, Helvetica, sans-serif", label: "Arial", category: "Sans" },
  {
    value: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    label: "Helvetica Neue",
    category: "Sans",
  },
  {
    value: "Verdana, Geneva, sans-serif",
    label: "Verdana",
    category: "Sans",
  },
  { value: "Tahoma, Geneva, sans-serif", label: "Tahoma", category: "Sans" },
  {
    value: "'Trebuchet MS', Helvetica, sans-serif",
    label: "Trebuchet MS",
    category: "Sans",
  },
  {
    value: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    label: "Segoe UI",
    category: "Sans",
  },
  {
    value: "Roboto, 'Helvetica Neue', Arial, sans-serif",
    label: "Roboto",
    category: "Sans",
  },
  {
    value: "Inter, 'Helvetica Neue', Arial, sans-serif",
    label: "Inter",
    category: "Sans",
  },
  {
    value: "'Gill Sans', 'Gill Sans MT', Calibri, sans-serif",
    label: "Gill Sans",
    category: "Sans",
  },
  {
    value: "Optima, Candara, 'Segoe UI', sans-serif",
    label: "Optima",
    category: "Sans",
  },
  {
    value: "'Lucida Grande', 'Lucida Sans Unicode', sans-serif",
    label: "Lucida Grande",
    category: "Sans",
  },
  {
    value: "Futura, 'Century Gothic', AppleGothic, sans-serif",
    label: "Futura",
    category: "Sans",
  },
  // Serif
  {
    value: "Georgia, 'Times New Roman', serif",
    label: "Georgia",
    category: "Serif",
  },
  {
    value: "'Times New Roman', Times, serif",
    label: "Times New Roman",
    category: "Serif",
  },
  {
    value: "Garamond, Baskerville, 'Times New Roman', serif",
    label: "Garamond",
    category: "Serif",
  },
  {
    value: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif",
    label: "Palatino",
    category: "Serif",
  },
  {
    value: "Baskerville, 'Baskerville Old Face', Georgia, serif",
    label: "Baskerville",
    category: "Serif",
  },
  {
    value: "Cambria, Georgia, 'Times New Roman', serif",
    label: "Cambria",
    category: "Serif",
  },
  {
    value: "'Hoefler Text', 'Baskerville Old Face', Garamond, serif",
    label: "Hoefler Text",
    category: "Serif",
  },
  // Monospace and display
  {
    value: "'Courier New', Courier, monospace",
    label: "Courier New",
    category: "Mono",
  },
  {
    value: "Consolas, 'Lucida Console', Monaco, monospace",
    label: "Consolas",
    category: "Mono",
  },
  {
    value: "Menlo, Monaco, Consolas, monospace",
    label: "Menlo",
    category: "Mono",
  },
  {
    value: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
    label: "Impact",
    category: "Display",
  },
  {
    value: "'Copperplate', 'Copperplate Gothic Light', fantasy",
    label: "Copperplate",
    category: "Display",
  },
  {
    value: "'Brush Script MT', 'Segoe Script', cursive",
    label: "Brush Script",
    category: "Script",
  },
] as const;

/**
 * Turns a block's design overrides into a style object. Only keys the user
 * actually set are emitted, so an untouched block inherits the campaign's
 * palette and the type's own defaults rather than being pinned to them.
 */
/**
 * Typography and colour, for the element that actually carries the text.
 *
 * These MUST be applied to the text node itself, not to a wrapper. A renderer
 * sets its own defaults as classes (`text-slate-900`, `text-[32px]`), and a
 * class on an element always beats a value inherited from its parent — so a
 * font size or colour set on a wrapper is silently discarded. Applying them
 * inline on the same element is what makes the Design tab take effect.
 */
const SHADOWS: Record<string, string> = {
  none: "none",
  sm: "0 1px 2px rgba(15,23,42,.08)",
  md: "0 4px 12px rgba(15,23,42,.10)",
  lg: "0 12px 32px rgba(15,23,42,.16)",
};

/**
 * The design for one breakpoint. Narrower screens inherit everything and
 * override only what was actually set for them, so a block styled once still
 * renders everywhere.
 */
export const campaignDesignAt = (
  block: CampaignBlock,
  breakpoint: CampaignBreakpoint = "desktop",
): CampaignBlockDesign => {
  const design = block.design || {};
  if (breakpoint === "desktop") return design;
  // Tablet values also apply on mobile unless mobile states its own.
  const tablet = design.tablet || {};
  const overrides =
    breakpoint === "tablet" ? tablet : { ...tablet, ...(design.mobile || {}) };
  return { ...design, ...overrides };
};

export const campaignBlockTextStyle = (
  block: CampaignBlock,
  breakpoint: CampaignBreakpoint = "desktop",
): Record<string, string> => {
  const design = campaignDesignAt(block, breakpoint);
  const style: Record<string, string> = {};
  if (design.textColor) style.color = design.textColor;
  if (design.fontFamily) style.fontFamily = design.fontFamily;
  if (design.fontSize) style.fontSize = `${design.fontSize}px`;
  if (design.fontWeight) style.fontWeight = String(design.fontWeight);
  if (design.lineHeight) style.lineHeight = String(design.lineHeight);
  if (design.letterSpacing != null && design.letterSpacing !== 0) {
    style.letterSpacing = `${design.letterSpacing}px`;
  }
  if (design.textTransform && design.textTransform !== "none") {
    style.textTransform = design.textTransform;
  }
  if (design.textAlign) style.textAlign = design.textAlign;
  return style;
};

/**
 * The box around the block — the band it sits on, its spacing and its border.
 * Safe on a wrapper, because nothing inside re-declares these.
 */
const boxRule = (box: CampaignBoxSpacing) =>
  `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`;

/**
 * Layer one: the wrapper. The band across the email that the element sits on.
 *
 * Reads `design.container`. Anything a block set before the two layers existed
 * still renders here, so older campaigns keep the look they were saved with.
 */
export const campaignContainerStyle = (
  block: CampaignBlock,
  breakpoint: CampaignBreakpoint = "desktop",
): Record<string, string> => {
  const design = campaignDesignAt(block, breakpoint);
  const container = design.container || {};
  const style: Record<string, string> = {};

  if (container.backgroundColor) {
    style.backgroundColor = container.backgroundColor;
  }
  // An image sits above the colour, a gradient above both — each is a more
  // specific choice than the one before it.
  const layers: string[] = [];
  if (container.backgroundImage) {
    layers.push(`url(${JSON.stringify(container.backgroundImage)})`);
  }
  if (container.gradient?.from && container.gradient?.to) {
    layers.unshift(
      `linear-gradient(${container.gradient.angle ?? 180}deg, ${container.gradient.from}, ${container.gradient.to})`,
    );
  }
  if (layers.length) {
    style.backgroundImage = layers.join(", ");
    style.backgroundSize = container.backgroundSize || "cover";
    style.backgroundPosition = container.backgroundPosition || "center";
    style.backgroundRepeat = "no-repeat";
  }
  if (hasSpacing(container.padding)) style.padding = boxRule(container.padding!);
  if (hasSpacing(container.margin)) style.margin = boxRule(container.margin!);
  if (container.borderWidth) {
    style.borderWidth = `${container.borderWidth}px`;
    style.borderStyle = container.borderStyle || "solid";
    style.borderColor = container.borderColor || "#E2E8F0";
  }
  if (container.borderRadius) {
    style.borderRadius = `${container.borderRadius}px`;
  }
  if (container.maxWidth) {
    style.maxWidth = `${container.maxWidth}px`;
    // Centring a capped wrapper is what "align centre" means for a container.
    if (container.align === "center") style.margin = style.margin || "0 auto";
  }
  if (container.align) style.textAlign = container.align;
  if (container.shadow && container.shadow !== "none") {
    style.boxShadow = SHADOWS[container.shadow] || SHADOWS.md;
  }
  if (container.opacity != null && container.opacity < 100) {
    style.opacity = String(Math.max(0, Math.min(100, container.opacity)) / 100);
  }
  return style;
};

/**
 * Layer two: the element. The button, the heading, the image itself.
 *
 * Everything here is applied by the renderer directly to that element, which is
 * both what makes a button's border land on the button, and what stops a
 * renderer's own class from quietly winning over the user's choice.
 */
export const campaignElementStyle = (
  block: CampaignBlock,
  breakpoint: CampaignBreakpoint = "desktop",
): Record<string, string> => {
  const design = campaignDesignAt(block, breakpoint);
  const style: Record<string, string> = { ...campaignBlockTextStyle(block, breakpoint) };

  if (design.borderWidth) {
    style.borderWidth = `${design.borderWidth}px`;
    style.borderStyle = design.borderStyle || "solid";
    style.borderColor = design.borderColor || "#E2E8F0";
  }
  if (design.borderRadius) style.borderRadius = `${design.borderRadius}px`;
  if (hasSpacing(design.elementPadding)) {
    style.padding = boxRule(design.elementPadding!);
  }
  if (design.width) style.width = `${design.width}px`;
  if (design.height) style.height = `${design.height}px`;
  if (design.objectFit) style.objectFit = design.objectFit;
  if (design.shadow && design.shadow !== "none") {
    style.boxShadow = SHADOWS[design.shadow] || SHADOWS.md;
  }
  if (design.opacity != null && design.opacity < 100) {
    style.opacity = String(Math.max(0, Math.min(100, design.opacity)) / 100);
  }
  return style;
};

/** Retained name, now meaning the wrapper layer. */
export const campaignBlockBoxStyle = campaignContainerStyle;

/**
 * Both layers together. Used only where a single element has to carry
 * everything; the canvas and the export keep them apart.
 */
export const campaignBlockStyle = (
  block: CampaignBlock,
  breakpoint: CampaignBreakpoint = "desktop",
): Record<string, string> => ({
  ...campaignContainerStyle(block, breakpoint),
  ...campaignElementStyle(block, breakpoint),
});

/**
 * The fill for the element inside a block — a button, a coupon chip, a banner.
 *
 * Falls back to the campaign accent, so a block that has never been touched
 * still paints from the palette.
 */
export const campaignElementFill = (
  block: CampaignBlock,
  accent: string,
) => campaignColor(block.design?.elementBackground, accent);

export type CampaignVideoSource =
  | { provider: "youtube"; id: string; embedUrl: string; thumbnail: string }
  | { provider: "vimeo"; id: string; embedUrl: string; thumbnail: "" }
  | { provider: "file"; id: ""; embedUrl: string; thumbnail: "" }
  | null;

/**
 * Works out what a pasted video URL actually is.
 *
 * The builder can embed and play these, so the editor shows the real video.
 * The sent email cannot — no inbox runs an iframe or a <video> tag — which is
 * why the export still falls back to a poster frame that links out.
 */
export const resolveCampaignVideo = (value: unknown): CampaignVideoSource => {
  const url = String(value || "").trim();
  if (!url) return null;

  const youtube =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(
      url,
    );
  if (youtube) {
    const id = youtube[1];
    return {
      provider: "youtube",
      id,
      embedUrl: `https://www.youtube.com/embed/${id}`,
      thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    };
  }

  const vimeo = /vimeo\.com\/(?:video\/)?(\d{6,})/.exec(url);
  if (vimeo) {
    return {
      provider: "vimeo",
      id: vimeo[1],
      embedUrl: `https://player.vimeo.com/video/${vimeo[1]}`,
      thumbnail: "",
    };
  }

  // A direct file, either hosted or uploaded as a data URI.
  if (/^data:video\//i.test(url) || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) {
    return { provider: "file", id: "", embedUrl: url, thumbnail: "" };
  }
  return null;
};

/** Blocks that have a distinct filled element separate from their band. */
export const BLOCKS_WITH_ELEMENT_FILL: CampaignBlockType[] = [
  "button",
  "button_group",
  "cta_banner",
  "coupon",
  "hero",
  "feature_list",
  "stats",
];

const declarationsFrom = (style: Record<string, string>) =>
  Object.entries(style).map(
    ([property, value]) =>
      `${property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}:${value}`,
  );

/** The container layer as an inline `style` string, for the exported wrapper. */
export const containerStyleAttribute = (block: CampaignBlock) => {
  const declarations = declarationsFrom(campaignContainerStyle(block));
  const custom = String(block.advanced?.customCss || "").trim();
  if (custom) declarations.push(custom.replace(/;+$/, ""));
  return declarations.join(";");
};

/** The element layer as an inline `style` string, for the exported element. */
export const elementStyleAttribute = (block: CampaignBlock) =>
  declarationsFrom(campaignElementStyle(block)).join(";");

/** The same style object as an inline `style` attribute string, for export. */
export const campaignBlockStyleAttribute = (block: CampaignBlock) => {
  const style = campaignBlockStyle(block);
  const declarations = Object.entries(style).map(
    ([property, value]) =>
      `${property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}:${value}`,
  );
  const custom = String(block.advanced?.customCss || "").trim();
  // Custom CSS is appended last so it wins over the Design tab, which is the
  // point of an escape hatch.
  if (custom) declarations.push(custom.replace(/;+$/, ""));
  return declarations.join(";");
};

const isCampaignBlock = (value: unknown): value is CampaignBlock => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  return (
    typeof block.id === "string" &&
    Object.prototype.hasOwnProperty.call(
      campaignBlockLabels,
      String(block.type),
    )
  );
};

export const emptyCampaignDesign = (): CampaignDesign => ({
  accent: "#635BFF",
  pageBackground: "#F5F7FB",
  cardBackground: "#FFFFFF",
  footerText: "Sent by {{workspace.name}}",
  blocks: [],
});

/**
 * Reads the stored envelope back into a design. A campaign saved before the
 * block model existed keeps its HTML as the source of truth, so the caller can
 * tell the difference and offer to rebuild rather than silently discarding it.
 */
export const campaignDesignFromBlocks = (
  blocks: unknown[],
): { design: CampaignDesign; legacyHtml: string } => {
  const envelope = blocks.find(
    (block) =>
      block &&
      typeof block === "object" &&
      !Array.isArray(block) &&
      (block as Record<string, unknown>).type === "campaign_design",
  ) as Record<string, unknown> | undefined;
  const base = emptyCampaignDesign();
  if (!envelope) return { design: base, legacyHtml: "" };
  const saved = Array.isArray(envelope.blocks)
    ? envelope.blocks.filter(isCampaignBlock)
    : [];
  return {
    design: {
      accent: String(envelope.accent || base.accent),
      pageBackground: String(envelope.pageBackground || base.pageBackground),
      cardBackground: String(envelope.cardBackground || base.cardBackground),
      footerText: String(envelope.footerText || base.footerText),
      container:
        envelope.container && typeof envelope.container === "object"
          ? (envelope.container as CampaignContainer)
          : undefined,
      // Read back with the rest of the envelope, or a text-only email would
      // lose its type settings the moment it was reopened.
      typography:
        envelope.typography && typeof envelope.typography === "object"
          ? (envelope.typography as CampaignTypography)
          : undefined,
      authoringMode:
        envelope.authoringMode === "plain_text" ||
        envelope.authoringMode === "custom_html" ||
        envelope.authoringMode === "builder"
          ? envelope.authoringMode
          : undefined,
      blocks: saved.map((block) => ({ ...block })),
    },
    legacyHtml: String(envelope.legacyHtml || ""),
  };
};

export const campaignBlocksPayload = (design: CampaignDesign) => [
  { type: "campaign_design", version: 1, ...design },
];

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] || character,
  );

export const campaignColor = (value: string | undefined, fallback: string) =>
  /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;

/** Only https links and template variables reach the composed email. */
export const campaignLink = (value: string | undefined) => {
  const href = String(value || "").trim();
  return /^(https:\/\/|mailto:|\{\{)/i.test(href) ? href : "";
};

export const campaignImageSource = (value: string | undefined) => {
  const src = String(value || "").trim();
  return /^(https:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(src)
    ? src
    : "";
};

export const socialNetworkLabels: Record<
  CampaignSocialItem["network"],
  string
> = {
  website: "Website",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  facebook: "Facebook",
  youtube: "YouTube",
};

/**
 * The countdown is a server-rendered image, not a live clock: email clients do
 * not run JavaScript. The endpoint regenerates the image on each open, so the
 * reader sees the time remaining at the moment they opened the message. This
 * is the technique every established sender uses; nothing here ticks in place.
 */
export const countdownImageUrl = (
  deadline: string | undefined,
  accent?: string,
) =>
  `/api/campaigns/countdown?deadline=${encodeURIComponent(
    String(deadline || ""),
  )}&accent=${encodeURIComponent(campaignColor(accent, "#635BFF"))}`;

export const countdownRemaining = (deadline: string | undefined) => {
  const target = new Date(String(deadline || "")).getTime();
  if (!Number.isFinite(target)) return null;
  const milliseconds = target - Date.now();
  if (milliseconds <= 0) return { days: 0, hours: 0, minutes: 0, past: true };
  return {
    days: Math.floor(milliseconds / 86_400_000),
    hours: Math.floor((milliseconds % 86_400_000) / 3_600_000),
    minutes: Math.floor((milliseconds % 3_600_000) / 60_000),
    past: false,
  };
};

/**
 * Wraps a block's markup with its Design-tab overrides and Advanced settings.
 *
 * Visibility uses inline `display:none` plus a class the campaign stylesheet
 * flips at 480px, because that is the only responsive mechanism email clients
 * agree on.
 */
const blockHtml = (
  block: CampaignBlock,
  accent: string,
  type: Required<CampaignTypography> = defaultCampaignTypography,
): string => {
  const inner = blockContentHtml(block, accent, type);
  if (!inner) return "";
  const advanced = block.advanced || {};
  // The wrapper carries only the container layer. The element layer is written
  // by the content renderer onto the element itself, so a button's border ships
  // on the button rather than around the section.
  const style = containerStyleAttribute(block);
  const classes = [
    advanced.cssClass || "",
    advanced.hideOnMobile ? "mf-hide-mobile" : "",
    advanced.hideOnDesktop ? "mf-hide-desktop" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (!style && !classes && !advanced.htmlId) return inner;
  const attributes = [
    advanced.htmlId ? ` id="${escapeHtml(advanced.htmlId)}"` : "",
    classes ? ` class="${escapeHtml(classes)}"` : "",
    style ? ` style="${escapeHtml(style)}"` : "",
  ].join("");
  return `<div${attributes}>${inner}</div>`;
};

const blockContentHtml = (
  block: CampaignBlock,
  campaignAccent: string,
  type: Required<CampaignTypography> = defaultCampaignTypography,
): string => {
  const align = block.align === "center" ? "center" : "left";
  const textAlign = `text-align:${align}`;
  // Mirrors the canvas: a block's own text colour wins wherever the block
  // paints text with the accent, and the element fill is kept separate from
  // the block's background band.
  const accent = block.design?.textColor || campaignAccent;
  const fill = campaignElementFill(block, campaignAccent);
  if (block.type === "label") {
    return `<p style="margin:0 0 14px;color:${accent};font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;${textAlign}">${escapeHtml(block.content || "")}</p>`;
  }
  if (block.type === "heading") {
    // Small/medium/large map onto the document's three heading levels, so the
    // type settings and the per-block size control cannot disagree.
    const level =
      block.size === "small"
        ? { size: type.headingThreeSize, family: type.headingThreeFamily }
        : block.size === "medium"
          ? { size: type.headingTwoSize, family: type.headingTwoFamily }
          : { size: type.headingOneSize, family: type.headingOneFamily };
    const family = level.family ? `font-family:${level.family};` : "";
    return `<h1 style="margin:0 0 18px;color:#172033;font-size:${level.size}px;line-height:1.22;font-weight:700;${family}${textAlign}">${escapeHtml(block.content || "")}</h1>`;
  }
  if (block.type === "text") {
    return `<p style="margin:0 0 20px;color:#526077;font-size:${type.fontSize}px;line-height:1.65;${textAlign}">${escapeHtml(block.content || "").replace(/\n/g, "<br>")}</p>`;
  }
  if (block.type === "button") {
    const href = campaignLink(block.href);
    if (!href) return "";
    return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;${align === "center" ? "margin-left:auto;margin-right:auto" : ""}"><tr><td style="border-radius:9px;background:${fill}"><a href="${escapeHtml(href)}" style="display:inline-block;border-radius:9px;color:#ffffff;padding:13px 20px;font-size:14px;font-weight:700;text-decoration:none;${elementStyleAttribute(block)}">${escapeHtml(block.content || "View details")}</a></td></tr></table>`;
  }
  if (block.type === "image") {
    const src = campaignImageSource(block.src);
    if (!src) return "";
    return `<div style="margin:0 0 24px;${textAlign}"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt || "")}" style="display:inline-block;max-width:100%;height:auto;border:0;border-radius:12px" /></div>`;
  }
  if (block.type === "divider") {
    return `<div style="height:1px;margin:4px 0 24px;background:#E6EAF0"></div>`;
  }
  if (block.type === "spacer") {
    const height = Math.min(120, Math.max(8, Math.round(block.height || 24)));
    return `<div style="height:${height}px;line-height:${height}px">&nbsp;</div>`;
  }
  if (block.type === "hero") {
    const src = campaignImageSource(block.src);
    const overlay = Math.min(80, Math.max(0, Math.round(block.overlay ?? 45)));
    const href = campaignLink(block.href);
    const button = href
      ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px auto 0"><tr><td style="border-radius:9px;background:#ffffff"><a href="${escapeHtml(href)}" style="display:inline-block;border-radius:9px;color:${accent};padding:12px 20px;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(block.buttonLabel || "View details")}</a></td></tr></table>`
      : "";
    // Background images are unreliable across clients, so the overlay colour is
    // painted as the cell background with the image layered behind it.
    const background = src
      ? `background-color:${accent};background-image:url('${escapeHtml(src)}');background-size:cover;background-position:center`
      : `background-color:${accent}`;
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 26px;border-radius:14px;overflow:hidden"><tr><td style="${background};padding:0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="background-color:rgba(9,14,28,${(overlay / 100).toFixed(2)});padding:44px 30px;text-align:center"><h1 style="margin:0;color:#ffffff;font-size:30px;line-height:1.24;font-weight:700">${escapeHtml(block.content || "")}</h1>${block.subtext ? `<p style="margin:12px 0 0;color:#EEF1F7;font-size:16px;line-height:1.6">${escapeHtml(block.subtext)}</p>` : ""}${button}</td></tr></table></td></tr></table>`;
  }
  if (block.type === "product_grid") {
    const items = (block.items || []).filter((item) => item.title);
    if (!items.length) return "";
    const columns = Math.min(3, Math.max(1, block.columns || 2));
    const width = `${Math.floor(100 / columns)}%`;
    const cells = items.map((item) => {
      const href = campaignLink(item.href);
      const image = campaignImageSource(item.imageSrc);
      const title = escapeHtml(item.title);
      const inner = `${image ? `<img src="${escapeHtml(image)}" alt="${title}" style="display:block;width:100%;height:auto;border:0;border-radius:10px;margin:0 0 10px" />` : ""}<p style="margin:0;color:#172033;font-size:15px;font-weight:600;line-height:1.4">${title}</p><p style="margin:6px 0 0;color:#526077;font-size:14px">${escapeHtml(item.price)}</p>`;
      return `<td width="${width}" valign="top" style="padding:0 8px 20px">${href ? `<a href="${escapeHtml(href)}" style="text-decoration:none">${inner}</a>` : inner}</td>`;
    });
    const rows: string[] = [];
    for (let index = 0; index < cells.length; index += columns) {
      rows.push(`<tr>${cells.slice(index, index + columns).join("")}</tr>`);
    }
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px">${rows.join("")}</table>`;
  }
  if (block.type === "countdown") {
    return `<div style="margin:0 0 26px;text-align:center">${block.content ? `<p style="margin:0 0 10px;color:#526077;font-size:13px;font-weight:600;letter-spacing:.4px;text-transform:uppercase">${escapeHtml(block.content)}</p>` : ""}<img src="{{workspace.url}}${escapeHtml(countdownImageUrl(block.deadline, accent))}" alt="Time remaining in this offer" width="336" style="display:inline-block;max-width:100%;height:auto;border:0" /></div>`;
  }
  if (block.type === "social") {
    const links = (block.socials || [])
      .map((item) => {
        const href = campaignLink(item.href);
        if (!href) return "";
        return `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 7px;color:${accent};font-size:13px;font-weight:600;text-decoration:none">${escapeHtml(socialNetworkLabels[item.network] || item.network)}</a>`;
      })
      .filter(Boolean)
      .join("");
    if (!links) return "";
    return `<div style="margin:0 0 24px;text-align:center">${links}</div>`;
  }
  if (block.type === "testimonial") {
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 26px"><tr><td style="border-left:3px solid ${accent};padding:4px 0 4px 18px"><p style="margin:0;color:#172033;font-size:17px;line-height:1.6;font-style:italic">${escapeHtml(block.content || "")}</p>${block.attribution ? `<p style="margin:10px 0 0;color:#8A96AA;font-size:13px">${escapeHtml(block.attribution)}</p>` : ""}</td></tr></table>`;
  }
  if (block.type === "list") {
    const items = (block.listItems || []).filter(Boolean);
    if (!items.length) return "";
    const tag = block.listStyle === "number" ? "ol" : "ul";
    const marker =
      block.listStyle === "check" ? "list-style:none;padding-left:0;" : "";
    const rows = items
      .map(
        (item) =>
          `<li style="margin:0 0 8px;color:#526077;font-size:15px;line-height:1.65">${
            block.listStyle === "check"
              ? `<span style="color:${accent};font-weight:700">&#10003;</span> `
              : ""
          }${escapeHtml(item)}</li>`,
      )
      .join("");
    return `<${tag} style="margin:0 0 20px;padding-left:${block.listStyle === "check" ? "0" : "20px"};${marker}${textAlign}">${rows}</${tag}>`;
  }
  if (block.type === "quote") {
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px"><tr><td style="border-left:3px solid ${accent};padding:2px 0 2px 16px"><p style="margin:0;color:#172033;font-size:17px;line-height:1.55;font-style:italic;font-weight:500">${escapeHtml(block.content || "")}</p></td></tr></table>`;
  }
  if (block.type === "button_group") {
    const buttons = (block.entries || [])
      .map((entry) => {
        const href = campaignLink(entry.value);
        if (!href) return "";
        return `<td style="padding-right:8px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:9px;background:${fill}"><a href="${escapeHtml(href)}" style="display:inline-block;border-radius:9px;color:#ffffff;padding:12px 18px;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(entry.label || "Button")}</a></td></tr></table></td>`;
      })
      .filter(Boolean)
      .join("");
    if (!buttons) return "";
    return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;${align === "center" ? "margin-left:auto;margin-right:auto" : ""}"><tr>${buttons}</tr></table>`;
  }
  if (block.type === "image_gallery") {
    const cells = (block.items || [])
      .filter((item) => campaignImageSource(item.imageSrc))
      .map(
        (item) =>
          `<td style="padding:0 4px"><img src="${escapeHtml(campaignImageSource(item.imageSrc))}" alt="" width="180" style="display:block;width:100%;border-radius:6px" /></td>`,
      )
      .join("");
    if (!cells) return "";
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px"><tr>${cells}</tr></table>`;
  }
  if (block.type === "video") {
    const video = resolveCampaignVideo(block.href);
    const href = campaignLink(block.href);
    // Email clients strip iframes and generally do not play <video>. A
    // YouTube URL always has a reliable HTTPS thumbnail, so use it when the
    // author did not provide a custom poster frame.
    const poster =
      campaignImageSource(block.posterSrc) ||
      (video?.provider === "youtube" ? video.thumbnail : "");
    if (!href && !poster) return "";
    const image = poster
      ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml(block.content || "Watch")}" width="600" style="display:block;width:100%;border-radius:10px" />`
      : `<div style="background:#172033;border-radius:10px;padding:60px 0;text-align:center;color:#ffffff;font-size:14px">${escapeHtml(block.content || "Watch the video")}</div>`;
    const linkedImage = href
      ? `<a href="${escapeHtml(href)}" style="text-decoration:none">${image}</a>`
      : image;
    const watchLabel =
      video?.provider === "youtube" ? "Watch on YouTube" : "Watch video";
    const watchButton = href
      ? `<div style="margin:12px 0 0;text-align:center"><a href="${escapeHtml(href)}" style="display:inline-block;border-radius:999px;background:#172033;color:#ffffff;padding:10px 18px;font-size:13px;font-weight:700;line-height:1.2;text-decoration:none">&#9654;&nbsp;${watchLabel}</a></div>`
      : "";
    return `<div style="margin:0 0 24px;${textAlign}">${linkedImage}${watchButton}${block.content && poster ? `<p style="margin:8px 0 0;color:#8A96AA;font-size:13px">${escapeHtml(block.content)}</p>` : ""}</div>`;
  }
  if (block.type === "logo") {
    const source = campaignImageSource(block.src);
    if (!source) return "";
    return `<div style="margin:0 0 24px;${textAlign}"><img src="${escapeHtml(source)}" alt="${escapeHtml(block.alt || "Logo")}" height="${Math.max(16, Math.min(120, block.height || 40))}" style="display:inline-block;height:${Math.max(16, Math.min(120, block.height || 40))}px" /></div>`;
  }
  if (block.type === "columns") {
    const cells = (block.entries || [])
      .map(
        (entry) =>
          `<td width="50%" valign="top" style="padding:0 8px"><p style="margin:0 0 6px;color:#172033;font-size:15px;font-weight:600">${escapeHtml(entry.label)}</p><p style="margin:0;color:#526077;font-size:14px;line-height:1.6">${escapeHtml(entry.value)}</p></td>`,
      )
      .join("");
    if (!cells) return "";
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px"><tr>${cells}</tr></table>`;
  }
  if (block.type === "coupon") {
    return `<div style="margin:0 0 24px;text-align:center">${block.content ? `<p style="margin:0 0 10px;color:#8A96AA;font-size:13px">${escapeHtml(block.content)}</p>` : ""}<span style="display:inline-block;border:2px dashed ${accent};border-radius:10px;padding:12px 26px;color:${accent};font-size:20px;font-weight:700;letter-spacing:2px">${escapeHtml(block.couponCode || "CODE")}</span>${block.subtext ? `<p style="margin:10px 0 0;color:#8A96AA;font-size:11px">${escapeHtml(block.subtext)}</p>` : ""}</div>`;
  }
  if (block.type === "order_summary") {
    const entries = block.entries || [];
    if (!entries.length) return "";
    const rows = entries
      .map((entry, index) => {
        const last = index === entries.length - 1;
        return `<tr><td style="padding:10px 16px;color:${last ? "#172033" : "#526077"};font-size:13px;font-weight:${last ? 700 : 400};${last ? "border-top:1px solid #E6EAF0" : ""}">${escapeHtml(entry.label)}</td><td align="right" style="padding:10px 16px;color:${last ? "#172033" : "#526077"};font-size:13px;font-weight:${last ? 700 : 400};${last ? "border-top:1px solid #E6EAF0" : ""}">${escapeHtml(entry.value)}</td></tr>`;
      })
      .join("");
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border:1px solid #E6EAF0;border-radius:10px">${block.content ? `<tr><td colspan="2" style="padding:12px 16px;border-bottom:1px solid #E6EAF0;color:#172033;font-size:14px;font-weight:600">${escapeHtml(block.content)}</td></tr>` : ""}${rows}</table>`;
  }
  if (block.type === "menu") {
    const links = (block.entries || [])
      .map((entry) => {
        const href = campaignLink(entry.value);
        if (!href) return "";
        return `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 10px;color:${accent};font-size:13px;font-weight:600;text-decoration:none">${escapeHtml(entry.label)}</a>`;
      })
      .filter(Boolean)
      .join("");
    if (!links) return "";
    return `<div style="margin:0 0 24px;${textAlign}">${links}</div>`;
  }
  if (block.type === "stats") {
    const cells = (block.entries || [])
      .map(
        (entry) =>
          `<td align="center" style="padding:0 8px"><p style="margin:0;color:${accent};font-size:26px;font-weight:700;line-height:1.2">${escapeHtml(entry.value)}</p><p style="margin:4px 0 0;color:#8A96AA;font-size:11px;letter-spacing:1px;text-transform:uppercase">${escapeHtml(entry.label)}</p></td>`,
      )
      .join("");
    if (!cells) return "";
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px"><tr>${cells}</tr></table>`;
  }
  if (block.type === "feature_list") {
    const rows = (block.entries || [])
      .map(
        (entry) =>
          `<tr><td width="28" valign="top" style="padding:0 0 14px"><span style="display:inline-block;width:20px;height:20px;border-radius:10px;background:${fill};color:#ffffff;font-size:12px;font-weight:700;text-align:center;line-height:20px">&#10003;</span></td><td valign="top" style="padding:0 0 14px"><p style="margin:0;color:#172033;font-size:15px;font-weight:600">${escapeHtml(entry.label)}</p><p style="margin:2px 0 0;color:#526077;font-size:14px;line-height:1.6">${escapeHtml(entry.value)}</p></td></tr>`,
      )
      .join("");
    if (!rows) return "";
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px">${rows}</table>`;
  }
  if (block.type === "cta_banner") {
    const href = campaignLink(block.href);
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border-radius:12px;background:${fill}"><tr><td align="center" style="padding:28px 24px"><p style="margin:0;color:#ffffff;font-size:20px;font-weight:700">${escapeHtml(block.content || "")}</p>${block.subtext ? `<p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:14px">${escapeHtml(block.subtext)}</p>` : ""}${href ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px auto 0"><tr><td style="border-radius:8px;background:#ffffff"><a href="${escapeHtml(href)}" style="display:inline-block;border-radius:8px;color:#172033;padding:12px 20px;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(block.buttonLabel || "Get started")}</a></td></tr></table>` : ""}</td></tr></table>`;
  }
  if (block.type === "rating") {
    const stars = Math.max(0, Math.min(5, block.rating ?? 5));
    return `<div style="margin:0 0 24px;${textAlign}"><p style="margin:0;color:${accent};font-size:22px;letter-spacing:3px">${"&#9733;".repeat(stars)}<span style="color:#E6EAF0">${"&#9733;".repeat(5 - stars)}</span></p>${block.content ? `<p style="margin:6px 0 0;color:#8A96AA;font-size:12px">${escapeHtml(block.content)}</p>` : ""}</div>`;
  }
  if (block.type === "event_details") {
    const starts = block.eventStartsAt ? new Date(block.eventStartsAt) : null;
    const when =
      starts && !Number.isNaN(starts.getTime())
        ? starts.toLocaleString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "numeric",
            minute: "2-digit",
          })
        : "";
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border:1px solid #E6EAF0;border-radius:10px"><tr><td style="padding:14px 16px">${block.content ? `<p style="margin:0 0 8px;color:#172033;font-size:14px;font-weight:600">${escapeHtml(block.content)}</p>` : ""}${when ? `<p style="margin:0;color:#526077;font-size:14px">${escapeHtml(when)}</p>` : ""}${block.eventLocation ? `<p style="margin:4px 0 0;color:#526077;font-size:14px">${escapeHtml(block.eventLocation)}</p>` : ""}</td></tr></table>`;
  }
  if (block.type === "event_ticket") {
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border:1px solid #E6EAF0;border-radius:10px"><tr><td style="padding:16px"><p style="margin:0 0 8px;color:#172033;font-size:15px;font-weight:700">${escapeHtml(block.content || "Your ticket")}</p><p style="margin:0;color:#526077;font-size:14px">Ticket type: {{ticket.type}}</p><p style="margin:5px 0 0;color:#526077;font-size:14px">Ticket number: {{ticket.number}}</p><p style="margin:5px 0 0;color:#526077;font-size:14px">Ticket code: {{ticket.code}}</p></td></tr></table>`;
  }
  if (block.type === "event_access") {
    return `{{#if event.onlineAccess}}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border:1px solid ${accent};border-radius:10px"><tr><td style="padding:16px"><p style="margin:0 0 8px;color:#172033;font-size:15px;font-weight:700">${escapeHtml(block.content || "Join the event")}</p><a href="{{event.attendeeMeetingLink}}" style="display:inline-block;border-radius:8px;background:${fill};color:#ffffff;padding:12px 18px;font-size:14px;font-weight:700;text-decoration:none">Open secure meeting link</a><p style="margin:10px 0 0;color:#8A96AA;font-size:12px">{{event.meetingProvider}}</p></td></tr></table>{{/if}}`;
  }
  if (block.type === "calendar_links") {
    return `<div style="margin:0 0 24px;${textAlign}"><a href="{{event.calendarUrl}}" style="color:${accent};font-size:14px;font-weight:600;text-decoration:none">${escapeHtml(block.content || "Add to calendar")}</a></div>`;
  }
  if (block.type === "form") {
    // No <form> in the markup: clients strip it, and a form that silently fails
    // to submit is worse than a link that works. The fields are a prompt; the
    // button carries the real destination.
    const href = campaignLink(block.href);
    const fields = (block.entries || [])
      .map(
        (entry) =>
          `<tr><td style="padding:0 0 10px"><p style="margin:0 0 4px;color:#526077;font-size:12px;font-weight:500">${escapeHtml(entry.label)}</p><div style="border:1px solid #CBD5E1;border-radius:6px;padding:9px 12px;color:#94A3B8;font-size:13px">${escapeHtml(entry.value)}</div></td></tr>`,
      )
      .join("");
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px">${block.content ? `<tr><td style="padding:0 0 6px;color:#172033;font-size:16px;font-weight:600">${escapeHtml(block.content)}</td></tr>` : ""}${block.subtext ? `<tr><td style="padding:0 0 12px;color:#8A96AA;font-size:13px">${escapeHtml(block.subtext)}</td></tr>` : ""}${fields}${href ? `<tr><td style="padding:6px 0 0"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:8px;background:${fill}"><a href="${escapeHtml(href)}" style="display:inline-block;border-radius:8px;color:#ffffff;padding:12px 20px;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(block.buttonLabel || "Subscribe")}</a></td></tr></table></td></tr>` : ""}</table>`;
  }
  if (block.type === "html") {
    // Author-supplied markup for their own campaign. Scripts are stripped
    // because no inbox executes them and shipping one is pure risk.
    return String(block.html || "").replace(/<script[\s\S]*?<\/script>/gi, "");
  }
  const address = String(block.mailingAddress || "").trim();
  return `<div style="margin:8px 0 0;border-top:1px solid #E6EAF0;padding-top:18px;text-align:center"><p style="margin:0;color:#8A96AA;font-size:12px;line-height:1.6"><a href="{{unsubscribe.url}}" style="color:#8A96AA;text-decoration:underline">${escapeHtml(block.unsubscribeLabel || "Unsubscribe")}</a></p>${address ? `<p style="margin:8px 0 0;color:#8A96AA;font-size:12px;line-height:1.6">${escapeHtml(address).replace(/\n/g, "<br>")}</p>` : ""}</div>`;
};

/**
 * The one stylesheet the export carries. A media query is the only responsive
 * mechanism email clients broadly honour, so per-screen visibility is done here
 * rather than with inline styles.
 */
const VISIBILITY_STYLES =
  "<style>.mf-hide-desktop{display:none!important;max-height:0!important;overflow:hidden!important}" +
  "@media only screen and (max-width:480px){" +
  ".mf-hide-mobile{display:none!important;max-height:0!important;overflow:hidden!important}" +
  ".mf-hide-desktop{display:block!important;max-height:none!important;overflow:visible!important}" +
  "}</style>";

export const composeCampaignHtml = (design: CampaignDesign) => {
  const accent = campaignColor(design.accent, "#635BFF");
  const pageBackground = campaignColor(design.pageBackground, "#F5F7FB");
  const cardBackground = campaignColor(design.cardBackground, "#FFFFFF");
  const type = resolveTypography(design.typography);
  const content = design.blocks
    .map((block) => blockHtml(block, accent, type))
    .join("");
  const footer = escapeHtml(design.footerText || "Sent by {{workspace.name}}");
  const container = design.container || {};
  const width = Math.max(320, Math.min(900, container.width || 600));
  const radius = Math.max(0, Math.min(48, container.cornerRadius ?? 18));
  const stripe = Math.max(0, Math.min(24, container.stripeHeight ?? 7));
  const padding = Math.max(0, Math.min(64, container.contentPadding ?? 34));
  // The container keeps its own override for block designs; otherwise the
  // document type settings decide, which is what a text-only email edits.
  const fontFamily = container.fontFamily || type.fontFamily;
  const headerTitle = escapeHtml(String(container.headerTitle || ""));
  const headerIcon = escapeHtml(String(container.headerIcon || ""));
  const headerRow =
    headerTitle || headerIcon
      ? `<tr><td style="padding:14px ${padding}px;background:${campaignColor(container.headerBackground, cardBackground)};color:${campaignColor(container.headerTextColor, "#172033")};font-size:15px;font-weight:600">${headerIcon ? `<span style="font-size:18px">${headerIcon}</span> ` : ""}${headerTitle}</td></tr>`
      : "";
  return `<!doctype html><html lang="${type.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${VISIBILITY_STYLES}<style>a{color:${type.linkColor}}</style></head><body style="margin:0;background:${pageBackground};font-family:${fontFamily};color:#172033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:${width}px;background:${cardBackground};border-radius:${radius}px;overflow:hidden;box-shadow:0 12px 36px rgba(24,39,75,.10)">${stripe ? `<tr><td style="height:${stripe}px;background:${campaignColor(container.stripeColor, accent)}"></td></tr>` : ""}${headerRow}<tr><td style="padding:${padding}px ${padding}px 12px">${content}</td></tr><tr><td style="padding:8px ${padding}px 30px"><p style="margin:0;color:#8A96AA;font-size:12px;line-height:1.5">${footer}</p></td></tr></table></td></tr></table></body></html>`;
};

const blockText = (block: CampaignBlock): string => {
  if (block.type === "image") return block.alt || "";
  if (block.type === "divider" || block.type === "spacer") return "";
  if (block.type === "hero") {
    return [block.content, block.subtext].filter(Boolean).join(" — ");
  }
  if (block.type === "product_grid") {
    return (block.items || [])
      .map((item) => `${item.title} ${item.price}`.trim())
      .join(", ");
  }
  if (block.type === "social") {
    return (block.socials || [])
      .map((item) => socialNetworkLabels[item.network])
      .join(", ");
  }
  if (block.type === "testimonial") {
    return [block.content, block.attribution].filter(Boolean).join(" — ");
  }
  if (block.type === "event_ticket") return [block.content || "Your ticket", "{{ticket.type}}", "{{ticket.number}}"].join(" — ");
  if (block.type === "event_access") return [block.content || "Join the event", "{{event.attendeeMeetingLink}}"].join(" — ");
  if (block.type === "calendar_links") return block.content || "Add to calendar";
  if (block.type === "compliance_footer") {
    return [block.unsubscribeLabel, block.mailingAddress]
      .filter(Boolean)
      .join(" · ");
  }
  return block.content?.trim() || "";
};

export const campaignPlainText = (design: CampaignDesign) =>
  [...design.blocks.map(blockText).filter(Boolean), design.footerText.trim()]
    .filter(Boolean)
    .join("\n\n");

export const campaignHasComplianceFooter = (design: CampaignDesign) =>
  design.blocks.some(
    (block) =>
      block.type === "compliance_footer" &&
      String(block.mailingAddress || "").trim().length > 0,
  );

export type SpamFinding = {
  id: string;
  severity: "high" | "medium" | "low";
  message: string;
  /** Points added to the score. Higher score means more likely to be filtered. */
  weight: number;
};

/**
 * A heuristic spam check, not a deliverability guarantee.
 *
 * Every finding is a rule a marketer can act on. Inbox placement depends on
 * sender reputation, authentication, and recipient engagement — none of which
 * this can see — so the result is labelled as guidance everywhere it appears.
 */
const spamPhrases = [
  "act now",
  "buy now",
  "cash bonus",
  "click here",
  "congratulations",
  "credit card offer",
  "double your",
  "earn extra cash",
  "free gift",
  "free money",
  "guaranteed",
  "limited time only",
  "lowest price",
  "make money fast",
  "no credit check",
  "risk free",
  "satisfaction guaranteed",
  "urgent",
  "winner",
  "work from home",
];

export const campaignSpamReport = (input: {
  subject: string;
  previewText: string;
  design: CampaignDesign;
}) => {
  const findings: SpamFinding[] = [];
  const subject = input.subject.trim();
  const bodyText = input.design.blocks
    .map(blockText)
    .filter(Boolean)
    .join(" ")
    .trim();
  const haystack = `${subject} ${input.previewText} ${bodyText}`.toLowerCase();

  const matchedPhrases = spamPhrases.filter((phrase) =>
    haystack.includes(phrase),
  );
  if (matchedPhrases.length) {
    findings.push({
      id: "phrases",
      severity: matchedPhrases.length > 2 ? "high" : "medium",
      weight: Math.min(30, matchedPhrases.length * 8),
      message: `Filter-prone phrasing: ${matchedPhrases.slice(0, 4).join(", ")}${matchedPhrases.length > 4 ? "…" : ""}.`,
    });
  }

  const letters = subject.replace(/[^A-Za-z]/g, "");
  const capitals = subject.replace(/[^A-Z]/g, "");
  if (letters.length >= 6 && capitals.length / letters.length > 0.5) {
    findings.push({
      id: "subject-caps",
      severity: "high",
      weight: 18,
      message: "Over half the subject line is capitals.",
    });
  }

  // A run of exclamation marks in the subject is a much stronger signal than
  // the same count spread across a long body, so the two are counted apart.
  const subjectMarks = (subject.match(/[!?]/g) || []).length;
  const bodyMarks = (bodyText.match(/!/g) || []).length;
  if (subjectMarks > 1 || bodyMarks > 3) {
    findings.push({
      id: "exclamations",
      severity: subjectMarks > 1 ? "medium" : "low",
      weight: Math.min(14, subjectMarks * 5 + bodyMarks * 2),
      message:
        subjectMarks > 1
          ? `${subjectMarks} exclamation or question marks in the subject line alone.`
          : `${bodyMarks} exclamation points in the body.`,
    });
  }

  if (!subject) {
    findings.push({
      id: "subject-missing",
      severity: "high",
      weight: 25,
      message: "No subject line.",
    });
  } else if (subject.length > 70) {
    findings.push({
      id: "subject-long",
      severity: "low",
      weight: 6,
      message: `Subject is ${subject.length} characters; most inboxes cut off near 60.`,
    });
  }

  if (!input.previewText.trim()) {
    findings.push({
      id: "preheader-missing",
      severity: "low",
      weight: 5,
      message: "No preheader, so inboxes will show the first body line instead.",
    });
  }

  const imageBlocks = input.design.blocks.filter(
    (block) =>
      (block.type === "image" && campaignImageSource(block.src)) ||
      (block.type === "hero" && campaignImageSource(block.src)),
  ).length;
  const words = bodyText.split(/\s+/).filter(Boolean).length;
  if (imageBlocks && words < 40) {
    findings.push({
      id: "image-ratio",
      severity: "medium",
      weight: 15,
      message: `${imageBlocks} image${imageBlocks === 1 ? "" : "s"} with only ${words} words of text. Image-heavy mail is filtered more often.`,
    });
  }

  if (!campaignHasComplianceFooter(input.design)) {
    findings.push({
      id: "compliance",
      severity: "high",
      weight: 20,
      message:
        "No compliance footer with a physical mailing address. This blocks sending.",
    });
  }

  const insecureLinks = input.design.blocks.filter(
    (block) =>
      (block.type === "button" || block.type === "hero") &&
      String(block.href || "").trim().length > 0 &&
      !campaignLink(block.href),
  ).length;
  if (insecureLinks) {
    findings.push({
      id: "links",
      severity: "medium",
      weight: 12,
      message: `${insecureLinks} link${insecureLinks === 1 ? "" : "s"} are not a valid https address and will be dropped from the send.`,
    });
  }

  const score = Math.min(
    100,
    findings.reduce((total, finding) => total + finding.weight, 0),
  );
  return {
    score,
    rating: score >= 45 ? "poor" : score >= 20 ? "fair" : "good",
    findings: findings.sort((first, second) => second.weight - first.weight),
  } as const;
};

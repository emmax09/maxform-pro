import type { EmailTemplate } from "@/lib/email";

/**
 * Accent palette per module. `deep` is the far end of the card gradient and
 * `soft` the near end, so artwork reads as a lit surface rather than a flat fill.
 */
export const templateAccents: Record<
  string,
  { accent: string; soft: string; deep: string; icon: string }
> = {
  forms: { accent: "#F93D0A", soft: "#FFE0D6", deep: "#9A2505", icon: "✓" },
  events: { accent: "#7C3AED", soft: "#EDE9FE", deep: "#4C1D95", icon: "EV" },
  payments: { accent: "#0F766E", soft: "#CCFBF1", deep: "#134E4A", icon: "$" },
  documents: { accent: "#475569", soft: "#E2E8F0", deep: "#1E293B", icon: "✎" },
  contacts: { accent: "#DB2777", soft: "#FCE7F3", deep: "#831843", icon: "♥" },
  appointments: { accent: "#D97706", soft: "#FEF3C7", deep: "#78350F", icon: "◷" },
  workflows: { accent: "#635BFF", soft: "#EDE9FE", deep: "#312E81", icon: "↗" },
};

/**
 * Card imagery.
 *
 * These are illustrations rather than wireframes: a lit gradient field, soft
 * depth, and one large motif that says what the email is at a glance — a ticket,
 * a receipt, a calendar, a signature. Each is a self-contained SVG data URI, so
 * the cards need no network requests and stay crisp at any size.
 */
type ArtworkKind =
  | "ticket"
  | "schedule"
  | "receipt"
  | "invoice"
  | "signature"
  | "welcome"
  | "steps"
  | "reminder"
  | "alert"
  | "broadcast";

const artworkKinds: Record<string, ArtworkKind> = {
  event_ticket_confirmation: "ticket",
  event_registration_confirmation: "ticket",
  event_reminder: "schedule",
  event_schedule_update: "schedule",
  event_cancelled: "alert",
  order_confirmation: "receipt",
  order_receipt: "receipt",
  payment_receipt: "receipt",
  invoice_created: "invoice",
  invoice_paid: "invoice",
  refund_issued: "invoice",
  payment_failed: "alert",
  document_signature_request: "signature",
  document_signature_reminder: "signature",
  document_signed: "signature",
  campaign_send: "broadcast",
  contact_welcome: "welcome",
  team_invitation: "welcome",
  appointment_confirmed: "schedule",
  appointment_reminder_24h: "schedule",
  appointment_rescheduled: "schedule",
  appointment_cancelled: "alert",
  form_submission_confirmation: "steps",
  form_submission_admin_notice: "steps",
  form_submission_follow_up: "steps",
  form_submission_reminder: "reminder",
  workflow_thank_you: "steps",
  workflow_welcome: "welcome",
  workflow_follow_up: "steps",
  workflow_reminder: "reminder",
  workflow_announcement: "broadcast",
  workflow_custom: "steps",
};

const artworkKindFor = (template: EmailTemplate): ArtworkKind => {
  const known = artworkKinds[template.key];
  if (known) return known;
  const haystack = `${template.key} ${template.name}`.toLowerCase();
  if (/receipt|order|paid/.test(haystack)) return "receipt";
  if (/invoice|refund/.test(haystack)) return "invoice";
  if (/ticket/.test(haystack)) return "ticket";
  if (/sign|document/.test(haystack)) return "signature";
  if (/cancel|fail|error/.test(haystack)) return "alert";
  if (/remind/.test(haystack)) return "reminder";
  if (/welcome|invite/.test(haystack)) return "welcome";
  if (/announce|campaign|broadcast/.test(haystack)) return "broadcast";
  if (/appointment|event|schedule/.test(haystack)) return "schedule";
  return "steps";
};

/** A muted content line inside the floating card. */
const line = (x: number, y: number, width: number, opacity = 0.22, height = 9) =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#0B1220" opacity="${opacity}"/>`;

/** The motif is drawn on a 200x200 stage, then placed by the frame. */
const motif = (kind: ArtworkKind, accent: string) => {
  const glass = `fill="#FFFFFF" opacity=".97"`;
  switch (kind) {
    case "ticket":
      return `<g><rect x="14" y="52" width="172" height="96" rx="16" ${glass}/><path d="M118 56 V144" stroke="${accent}" stroke-width="3" stroke-dasharray="8 8" opacity=".45"/><rect x="34" y="72" width="52" height="9" rx="4.5" fill="${accent}" opacity=".55"/><rect x="34" y="90" width="66" height="20" rx="6" fill="${accent}"/><rect x="34" y="120" width="44" height="8" rx="4" fill="#0B1220" opacity=".18"/><rect x="132" y="78" width="36" height="8" rx="4" fill="#0B1220" opacity=".16"/><rect x="132" y="96" width="30" height="8" rx="4" fill="#0B1220" opacity=".12"/><rect x="132" y="114" width="36" height="8" rx="4" fill="#0B1220" opacity=".16"/></g>`;
    case "schedule":
      return `<g><rect x="30" y="34" width="140" height="132" rx="18" ${glass}/><rect x="30" y="34" width="140" height="36" rx="18" fill="${accent}"/><rect x="30" y="56" width="140" height="14" fill="${accent}"/><circle cx="62" cy="30" r="7" fill="${accent}"/><circle cx="138" cy="30" r="7" fill="${accent}"/><text x="100" y="122" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="46" font-weight="700" fill="${accent}">24</text><rect x="66" y="136" width="68" height="8" rx="4" fill="#0B1220" opacity=".16"/></g>`;
    case "receipt":
      return `<g><path d="M38 30 h124 v128 l-15 -10 l-16 10 l-16 -10 l-16 10 l-16 -10 l-15 10 z" ${glass}/><rect x="58" y="52" width="52" height="9" rx="4.5" fill="${accent}" opacity=".6"/><rect x="58" y="74" width="84" height="8" rx="4" fill="#0B1220" opacity=".16"/><rect x="58" y="92" width="66" height="8" rx="4" fill="#0B1220" opacity=".12"/><rect x="58" y="110" width="76" height="8" rx="4" fill="#0B1220" opacity=".16"/><rect x="58" y="132" width="84" height="14" rx="7" fill="${accent}"/></g>`;
    case "invoice":
      return `<g><rect x="26" y="26" width="118" height="148" rx="14" ${glass}/><rect x="46" y="50" width="52" height="9" rx="4.5" fill="${accent}" opacity=".6"/><rect x="46" y="72" width="78" height="8" rx="4" fill="#0B1220" opacity=".16"/><rect x="46" y="90" width="62" height="8" rx="4" fill="#0B1220" opacity=".12"/><rect x="46" y="108" width="72" height="8" rx="4" fill="#0B1220" opacity=".16"/><rect x="46" y="136" width="56" height="8" rx="4" fill="#0B1220" opacity=".12"/><circle cx="150" cy="132" r="42" fill="${accent}"/><text x="150" y="147" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="700" fill="#FFFFFF">$</text></g>`;
    case "signature":
      return `<g><rect x="30" y="26" width="140" height="148" rx="14" ${glass}/><rect x="52" y="50" width="70" height="8" rx="4" fill="#0B1220" opacity=".16"/><rect x="52" y="68" width="94" height="8" rx="4" fill="#0B1220" opacity=".12"/><rect x="52" y="86" width="82" height="8" rx="4" fill="#0B1220" opacity=".12"/><path d="M54 138 h92" stroke="#0B1220" stroke-width="2" opacity=".18"/><path d="M58 134 c16 -26 30 6 44 -12 c11 -14 24 12 36 -8" fill="none" stroke="${accent}" stroke-width="7" stroke-linecap="round"/><circle cx="150" cy="52" r="20" fill="${accent}"/><path d="M141 52 l6 7 l12 -14" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    case "welcome":
      return `<g><circle cx="100" cy="76" r="42" fill="#FFFFFF" opacity=".97"/><circle cx="100" cy="66" r="15" fill="${accent}"/><path d="M74 104 a26 20 0 0 1 52 0z" fill="${accent}"/><rect x="34" y="132" width="132" height="40" rx="14" fill="#FFFFFF" opacity=".97"/><rect x="52" y="146" width="60" height="8" rx="4" fill="${accent}" opacity=".6"/><rect x="52" y="160" width="40" height="6" rx="3" fill="#0B1220" opacity=".16"/><path d="M158 34 l5 13 l13 5 l-13 5 l-5 13 l-5 -13 l-13 -5 l13 -5z" fill="#FFFFFF" opacity=".85"/></g>`;
    case "steps":
      return `<g><rect x="24" y="34" width="152" height="132" rx="16" ${glass}/>${[0, 1, 2]
        .map(
          (index) =>
            `<circle cx="52" cy="${68 + index * 34}" r="13" fill="${accent}" opacity="${1 - index * 0.22}"/><path d="M46 ${68 + index * 34} l4 5 l8 -9" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="76" y="${63 + index * 34}" width="${78 - index * 16}" height="9" rx="4.5" fill="#0B1220" opacity="${0.2 - index * 0.04}"/>`,
        )
        .join("")}</g>`;
    case "reminder":
      return `<g><circle cx="100" cy="98" r="66" fill="#FFFFFF" opacity=".2"/><path d="M100 40 a34 34 0 0 1 34 34 v26 l13 17 h-94 l13 -17 v-26 a34 34 0 0 1 34 -34z" fill="#FFFFFF"/><path d="M100 46 a28 28 0 0 1 28 28 v26 l9 12 h-74 l9 -12 v-26 a28 28 0 0 1 28 -28z" fill="${accent}"/><path d="M86 128 a14 14 0 0 0 28 0z" fill="#FFFFFF"/><circle cx="140" cy="52" r="14" fill="#FFFFFF"/><circle cx="140" cy="52" r="8" fill="${accent}"/></g>`;
    case "alert":
      return `<g><path d="M100 34 l72 124 h-144z" fill="#FFFFFF"/><path d="M100 52 l58 100 h-116z" fill="${accent}"/><rect x="94" y="80" width="12" height="40" rx="6" fill="#FFFFFF"/><circle cx="100" cy="134" r="7" fill="#FFFFFF"/></g>`;
    case "broadcast":
    default:
      return `<g><path d="M34 82 l72 -30 v96 l-72 -30 z" fill="#FFFFFF"/><rect x="24" y="80" width="18" height="40" rx="6" fill="${accent}"/><path d="M56 122 v26 a12 12 0 0 0 24 0 v-18" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round"/><path d="M126 66 a44 44 0 0 1 0 68" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round" opacity=".9"/><path d="M150 46 a72 72 0 0 1 0 108" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round" opacity=".5"/></g>`;
  }
};

export const templateArtwork = (template: EmailTemplate) => {
  const palette = templateAccents[template.module] || templateAccents.workflows;
  const kind = artworkKindFor(template);
  const id = `${kind}${template.module}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 430" width="720" height="430"><defs><linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.accent}"/><stop offset="1" stop-color="${palette.deep}"/></linearGradient><radialGradient id="glow${id}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".38"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient><linearGradient id="card${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="${palette.soft}"/></linearGradient></defs><rect width="720" height="430" fill="url(#bg${id})"/><circle cx="150" cy="70" r="230" fill="url(#glow${id})"/><circle cx="620" cy="400" r="180" fill="#FFFFFF" opacity=".08"/><circle cx="596" cy="86" r="54" fill="#FFFFFF" opacity=".10"/><path d="M0 340 C 150 300 260 386 420 344 C 540 312 640 352 720 330 V430 H0 Z" fill="#FFFFFF" opacity=".08"/><g transform="translate(56 96) scale(1.09)">${motif(kind, palette.accent)}</g><g transform="translate(392 104)"><rect x="0" y="0" width="272" height="222" rx="20" fill="url(#card${id})"/><rect x="0" y="0" width="272" height="7" rx="3.5" fill="${palette.accent}"/><rect x="26" y="34" width="72" height="9" rx="4.5" fill="${palette.accent}" opacity=".75"/>${line(26, 60, 190, 0.26, 13)}${line(26, 86, 150, 0.2, 13)}${line(26, 122, 214)}${line(26, 142, 186, 0.16)}${line(26, 162, 160, 0.12)}<rect x="26" y="188" width="104" height="26" rx="9" fill="${palette.accent}"/></g></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

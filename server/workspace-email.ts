import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { neon } from "@neondatabase/serverless";

import {
  EmailAdapterError,
  emailProviderAdapter,
  type EmailProviderCredentials,
  type EmailProviderId,
  type ProviderBatchItemResult,
  type ProviderSendingLimits,
  type ProviderSendingDomain,
} from "./email-adapters";
import {
  managedSenderEmail,
  managedSenderPrefixError,
  normalizeManagedSenderPrefix,
  resolveStoredCustomSenderEmail,
} from "./email-sender-identity";
import { recordCampaignMessageEvent } from "./campaign-tracking";
import {
  enqueueCampaignWebhookJob,
  enqueueTransactionalEmailJob,
} from "./campaign-queue";
import { parseToSendWebhook } from "./tosend-webhook";
import { workspaceScopeFor } from "./workspace-access";

export type { EmailProviderId } from "./email-adapters";

type CredentialRecord = EmailProviderCredentials;
type DatabaseRow = Record<string, unknown>;
type EmailProviderMode = "managed" | "custom";

export class WorkspaceEmailError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "workspace_email_error",
    readonly retryable = false,
    readonly detail = message,
  ) {
    super(message);
  }
}

export const emailProviderSchemas: Record<
  EmailProviderId,
  {
    name: string;
    description: string;
    fields: Array<{
      key: string;
      label: string;
      type: "text" | "number" | "secret" | "select";
      default?: string;
      options?: string[];
    }>;
  }
> = {
  mock: {
    name: "Mock provider",
    description: "Deterministic provider for local and CI delivery tests.",
    fields: [],
  },
  tosend: {
    name: "ToSend",
    description: "Transactional and controlled batch delivery. Enter the ToSend API key through this secure, encrypted provider connection.",
    fields: [
      { key: "api_key", label: "API key", type: "secret" },
      { key: "access_mode", label: "Access scope", type: "select", default: "send", options: ["send", "send_receive"] },
    ],
  },
  resend: {
    name: "Resend",
    description: "Modern transactional email delivery with domain controls.",
    fields: [{ key: "api_key", label: "API key", type: "secret" }, { key: "access_mode", label: "Access scope", type: "select", default: "send", options: ["send", "send_receive"] }],
  },
  sender: {
    name: "Sender",
    description: "Transactional email delivery through Sender's official Email API.",
    fields: [{ key: "api_key", label: "API access token", type: "secret" }],
  },
  smtp: {
    name: "Custom SMTP",
    description: "Use Google Workspace, Microsoft 365, Zoho, or any authenticated SMTP relay.",
    fields: [
      {
        key: "preset",
        label: "Email service",
        type: "select",
        default: "Custom SMTP",
        options: ["Google Workspace", "Microsoft 365", "Zoho Mail", "Custom SMTP"],
      },
      { key: "host", label: "SMTP host", type: "text" },
      { key: "port", label: "Port", type: "number", default: "587" },
      {
        key: "authentication",
        label: "Authentication",
        type: "select",
        default: "Username and password",
        options: ["Username and password"],
      },
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "secret" },
      {
        key: "encryption",
        label: "Encryption",
        type: "select",
        default: "STARTTLS",
        options: ["TLS", "STARTTLS", "None"],
      },
    ],
  },
  sendgrid: {
    name: "SendGrid",
    description: "Transactional delivery through Twilio SendGrid.",
    fields: [{ key: "api_key", label: "API key", type: "secret" }, { key: "access_mode", label: "Access scope", type: "select", default: "send", options: ["send", "send_receive"] }],
  },
  postmark: {
    name: "Postmark",
    description: "High-deliverability transactional email.",
    fields: [{ key: "server_token", label: "Server token", type: "secret" }, { key: "access_mode", label: "Access scope", type: "select", default: "send", options: ["send", "send_receive"] }],
  },
  mailgun: {
    name: "Mailgun",
    description: "Flexible email API with domain-level sending.",
    fields: [
      { key: "api_key", label: "API key", type: "secret" },
      { key: "domain", label: "Sending domain", type: "text" },
      { key: "access_mode", label: "Access scope", type: "select", default: "send", options: ["send", "send_receive"] },
    ],
  },
  ses: {
    name: "Amazon SES",
    description: "AWS-native transactional delivery.",
    fields: [
      { key: "access_key_id", label: "Access key ID", type: "secret" },
      { key: "secret_access_key", label: "Secret access key", type: "secret" },
      {
        key: "region",
        label: "AWS region",
        type: "select",
        default: "us-east-1",
        options: ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"],
      },
      { key: "access_mode", label: "Access scope", type: "select", default: "send", options: ["send", "send_receive"] },
    ],
  },
};

/**
 * Seeded transactional emails.
 *
 * Every seed is a real message rather than a single paragraph: the sections
 * below cover the parts a transactional email actually needs — a summary panel
 * for the one value the reader came for, a detail table, next steps, and a
 * plain-language note. Sections are omitted when a template has no use for
 * them, so each type reads as if it were written for that moment.
 */
type SeedSection = {
  eyebrow: string;
  heading: string;
  intro: string;
  accent?: string;
  /** The single value the reader is looking for: a code, a total, a time. */
  highlight?: { label: string; value: string; note?: string };
  /** Label/value rows — order lines, appointment details, event logistics. */
  details?: Array<readonly [string, string]>;
  /** Heading above the detail rows. */
  detailsTitle?: string;
  /** "What happens next" steps. */
  steps?: string[];
  cta?: string;
  ctaUrl?: string;
  secondary?: { label: string; url: string };
  /** A quieter closing note: support, expectations, how to opt out. */
  note?: string;
};

const seedInk = "#101828";
const seedMuted = "#5a6a85";
const seedFaint = "#8a96aa";
const seedLine = "#e8ecf4";
const seedPanel = "#f7f9fc";
const seedFont =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";

const seedHighlight = (
  accent: string,
  highlight: NonNullable<SeedSection["highlight"]>,
) => `<tr><td style="padding:0 40px 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${seedPanel};border:1px solid ${seedLine};border-radius:12px"><tr><td style="padding:20px 22px"><p style="margin:0 0 6px;color:${seedFaint};font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase">${highlight.label}</p><p style="margin:0;color:${accent};font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-.2px">${highlight.value}</p>${highlight.note ? `<p style="margin:8px 0 0;color:${seedMuted};font-size:13px;line-height:1.5">${highlight.note}</p>` : ""}</td></tr></table></td></tr>`;

const seedDetails = (details: ReadonlyArray<readonly [string, string]>) =>
  `<tr><td style="padding:16px 40px 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${seedLine};border-radius:12px">${details
    .map(
      ([label, value], index) =>
        `<tr><td style="padding:13px 22px;${index ? `border-top:1px solid ${seedLine};` : ""}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="color:${seedMuted};font-size:13px;line-height:1.5">${label}</td><td align="right" style="color:${seedInk};font-size:13px;font-weight:600;line-height:1.5">${value}</td></tr></table></td></tr>`,
    )
    .join("")}</table></td></tr>`;

const seedSteps = (accent: string, steps: readonly string[]) =>
  `<tr><td style="padding:18px 40px 4px">${steps
    .map(
      (step, index) =>
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 10px"><tr><td width="26" valign="top" style="padding-top:1px"><span style="display:inline-block;width:20px;height:20px;border-radius:10px;background:${accent};color:#ffffff;font-size:11px;font-weight:700;text-align:center;line-height:20px">${index + 1}</span></td><td style="color:${seedMuted};font-size:14px;line-height:1.6">${step}</td></tr></table>`,
    )
    .join("")}</td></tr>`;

const seededEmail = (section: SeedSection) => {
  const accent = section.accent || "#635BFF";
  const rows = [
    `<tr><td style="height:6px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>`,
    `<tr><td style="padding:36px 40px 0"><p style="margin:0 0 12px;color:${accent};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">${section.eyebrow}</p><h1 style="margin:0;color:${seedInk};font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-.3px">${section.heading}</h1><p style="margin:16px 0 20px;color:${seedMuted};font-size:15px;line-height:1.65">${section.intro}</p></td></tr>`,
    section.highlight ? seedHighlight(accent, section.highlight) : "",
    section.details ? seedDetails(section.details) : "",
    section.steps ? seedSteps(accent, section.steps) : "",
    section.cta === ""
      ? ""
      : `<tr><td style="padding:22px 40px 4px"><a href="${section.ctaUrl || "{{action.url}}"}" style="display:inline-block;border-radius:10px;background:${accent};color:#ffffff;padding:14px 24px;font-size:14px;font-weight:700;text-decoration:none">${section.cta || "View details"}</a>${section.secondary ? `<a href="${section.secondary.url}" style="display:inline-block;margin-left:8px;padding:14px 12px;color:${seedMuted};font-size:13px;font-weight:600;text-decoration:none">${section.secondary.label}</a>` : ""}</td></tr>`,
    section.note
      ? `<tr><td style="padding:20px 40px 0"><p style="margin:0;padding-top:20px;border-top:1px solid ${seedLine};color:${seedMuted};font-size:13px;line-height:1.6">${section.note}</p></td></tr>`
      : "",
    `<tr><td style="padding:24px 40px 34px"><p style="margin:0;color:${seedFaint};font-size:12px;line-height:1.6">Sent by {{workspace.name}}</p></td></tr>`,
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;padding:0;background:#f4f6fb;font-family:${seedFont};color:${seedInk};-webkit-font-smoothing:antialiased"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb;padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid ${seedLine};border-radius:16px;overflow:hidden">${rows}</table></td></tr></table></body></html>`;
};

/**
 * The same section, expressed as builder blocks.
 *
 * The HTML above is what lands in the inbox; this is what opens in the editor.
 * Seeding both from one definition is what keeps a template's detail — its
 * summary panel, detail rows and steps — instead of the editor falling back to
 * a generic heading-and-paragraph stub that reads as "packed together".
 */
const seededBlocks = (key: string, section: SeedSection) => {
  const blocks: Record<string, unknown>[] = [];
  const push = (block: Record<string, unknown>) =>
    blocks.push({ id: `${key}-${blocks.length + 1}`, ...block });
  /** Breathing room between sections, so the mail does not read as one slab. */
  const gap = (height: number) => push({ type: "spacer", height });

  push({ type: "label", content: section.eyebrow, align: "left" });
  push({ type: "heading", content: section.heading, align: "left", size: "large" });
  push({ type: "text", content: section.intro, align: "left" });

  if (section.highlight) {
    gap(8);
    push({
      type: "stats",
      columns: 1,
      align: "left",
      entries: [
        {
          id: `${key}-highlight`,
          label: section.highlight.label,
          value: section.highlight.value,
        },
      ],
    });
    if (section.highlight.note) {
      push({ type: "text", content: section.highlight.note, align: "left" });
    }
  }

  if (section.details) {
    gap(8);
    push({
      type: "order_summary",
      content: section.detailsTitle || "Details",
      align: "left",
      entries: section.details.map(([label, value], index) => ({
        id: `${key}-detail-${index}`,
        label,
        value,
      })),
    });
  }

  if (section.steps) {
    gap(8);
    push({ type: "text", content: "What happens next", align: "left" });
    push({ type: "list", listStyle: "number", align: "left", listItems: [...section.steps] });
  }

  if (section.cta !== "") {
    gap(12);
    push({
      type: "button",
      content: section.cta || "View details",
      href: section.ctaUrl || "{{action.url}}",
      align: "left",
    });
  }

  if (section.note) {
    gap(12);
    push({ type: "divider" });
    push({ type: "text", content: section.note, align: "left" });
  }

  if (key.startsWith("event_")) {
    gap(8);
    if (["event_ticket_confirmation", "event_ticket_delivery", "event_payment_confirmation", "event_reminder", "event_checkin_confirmation"].includes(key)) {
      push({ type: "event_ticket", content: "Your ticket", align: "left" });
    }
    if (["event_online_access", "event_ticket_confirmation", "event_reminder"].includes(key)) {
      push({ type: "event_access", content: "Join the event", align: "left" });
    }
    push({ type: "calendar_links", content: "Add to calendar", align: "left" });
  }

  return [
    {
      type: "campaign_design",
      version: 1,
      accent: section.accent || "#635BFF",
      pageBackground: "#F4F6FB",
      cardBackground: "#FFFFFF",
      footerText: "Sent by {{workspace.name}}",
      blocks,
    },
  ];
};

/** One definition produces the delivered HTML, the plain text, and the blocks. */
const seed = (
  key: string,
  module: string,
  name: string,
  subject: string,
  section: SeedSection,
) =>
  [key, module, name, subject, seededEmail(section), JSON.stringify(seededBlocks(key, section))] as const;

/**
 * The built-in templates, exported so their contract can be asserted without a
 * database: every module's messages, their keys, and the variables each one
 * depends on at send time.
 */
export const templateSeeds = [
  seed("form_submission_confirmation", "forms", "Submission confirmation", "We received your response to {{form.title}}", {
    eyebrow: "Response received",
    heading: "Thanks — we have your response",
    intro: "Hi {{contact.name}}, your response to {{form.title}} came through successfully. Nothing else is needed from you right now.",
    accent: "#F93D0A",
    highlight: { label: "Reference", value: "{{response.reference}}", note: "Quote this reference if you contact us about this submission." },
    detailsTitle: "Submission details",
    details: [["Form", "{{form.title}}"], ["Submitted", "{{response.submittedAt}}"], ["Sent from", "{{response.email}}"]],
    steps: ["Our team reviews your response.", "If anything is unclear, we will reply to {{response.email}}.", "You can review a copy of your answers at any time."],
    cta: "View your response",
    note: "Did not fill this in? Let us know and we will remove the record.",
  }),
  seed("form_submission_admin_notice", "forms", "New submission notice", "New response for {{form.title}}", {
    eyebrow: "New response",
    heading: "A new response is waiting",
    intro: "Someone completed {{form.title}}. Here is the summary so you can follow up while it is still fresh.",
    accent: "#0F766E",
    detailsTitle: "Submission details",
    details: [["Form", "{{form.title}}"], ["From", "{{response.email}}"], ["Received", "{{response.submittedAt}}"], ["Reference", "{{response.reference}}"]],
    cta: "Review response",
    secondary: { label: "Open all responses", url: "{{form.url}}" },
    note: "You receive this because you are a notification recipient for {{form.title}}.",
  }),
  seed("form_submission_follow_up", "forms", "Form follow-up", "Following up on your {{form.title}} response", {
    eyebrow: "Follow-up",
    heading: "Thanks for getting in touch",
    intro: "Hi {{contact.name}}, we have been through your response to {{form.title}} and wanted to come back to you with the next step.",
    accent: "#F93D0A",
    steps: ["Read the summary of what you told us.", "Confirm the details are still right.", "Pick a time that suits you, or reply to this email."],
    cta: "Continue where you left off",
    note: "Replying to this email reaches our team directly.",
  }),
  seed("form_submission_reminder", "forms", "Incomplete response reminder", "Your {{form.title}} response is almost done", {
    eyebrow: "Almost there",
    heading: "Your answers are saved",
    intro: "Hi {{contact.name}}, you started {{form.title}} but did not finish. Your progress is saved, so you can pick up exactly where you stopped.",
    accent: "#D97706",
    detailsTitle: "Submission details",
    details: [["Form", "{{form.title}}"], ["Started", "{{response.startedAt}}"], ["Progress", "{{response.progress}}"]],
    cta: "Finish your response",
    note: "If you no longer need to complete this, you can ignore this reminder.",
  }),
  seed("event_ticket_confirmation", "events", "Ticket confirmation", "Your ticket for {{event.name}}", {
    eyebrow: "You are going",
    heading: "Your ticket is confirmed",
    intro: "Hi {{contact.name}}, you are all set for {{event.name}}. Show the code below at the door — a screenshot works just as well.",
    accent: "#7C3AED",
    highlight: { label: "Ticket code", value: "{{ticket.code}}", note: "{{ticket.type}} · {{ticket.holder}}" },
    detailsTitle: "Event details",
    details: [["Event", "{{event.name}}"], ["Date", "{{event.date}}"], ["Doors open", "{{event.startTime}}"], ["Location", "{{event.location}}"]],
    steps: ["Save this email or add the event to your calendar.", "Arrive a few minutes early for check-in.", "Have your ticket code ready on your phone."],
    cta: "View your ticket",
    secondary: { label: "Add to calendar", url: "{{event.calendarUrl}}" },
    note: "Cannot make it? Let us know so we can offer your place to someone else.",
  }),
  seed("event_ticket_delivery", "events", "Ticket delivery", "Your ticket{{#if tickets.quantity}} ({{tickets.quantity}}){{/if}} for {{event.name}}", {
    eyebrow: "Ticket ready",
    heading: "Your event ticket is ready",
    intro: "Hi {{contact.name}}, your confirmed ticket(s) for {{event.name}} are ready. Keep this email or open your secure order page before you arrive.",
    accent: "#0F766E",
    highlight: { label: "Ticket number(s)", value: "{{tickets.numbers}}", note: "{{tickets.summary}}" },
    detailsTitle: "Purchase details",
    details: [["Event", "{{event.name}}"], ["Date", "{{event.date}}"], ["Time", "{{event.startTime}} ({{event.timezone}})"], ["Ticket type(s)", "{{tickets.summary}}"], ["Quantity", "{{tickets.quantity}}"], ["Order", "{{order.number}}"]],
    steps: ["Open the secure order page to download the ticket artwork.", "Present the QR code or ticket number at the entrance.", "Do not forward a ticket assigned to another attendee."],
    cta: "Open secure ticket page",
    ctaUrl: "{{ticket.downloadUrl}}",
    secondary: { label: "View order summary", url: "{{order.summaryUrl}}" },
    note: "If your ticket details look wrong, contact the event organizer before arriving.",
  }),
  seed("event_registration_confirmation", "events", "Registration confirmation", "You are registered for {{event.name}}", {
    eyebrow: "Registration complete",
    heading: "You are on the list",
    intro: "Thanks for registering for {{event.name}}, {{contact.name}}. We will send joining details closer to the day.",
    accent: "#7C3AED",
    detailsTitle: "Event details",
    details: [["Event", "{{event.name}}"], ["Date", "{{event.date}}"], ["Time", "{{event.startTime}}"], ["Location", "{{event.location}}"]],
    steps: ["Add the date to your calendar.", "Watch for joining details a few days beforehand.", "Bring any questions you would like covered."],
    cta: "View event details",
    secondary: { label: "Add to calendar", url: "{{event.calendarUrl}}" },
  }),
  seed("event_payment_confirmation", "events", "Payment confirmation", "Payment confirmed for {{event.name}}", {
    eyebrow: "Payment confirmed",
    heading: "Your registration is complete",
    intro: "Hi {{contact.name}}, your payment for {{event.name}} was received successfully.",
    accent: "#0F766E",
    detailsTitle: "Order details",
    details: [["Event", "{{event.name}}"], ["Order", "{{order.number}}"], ["Amount paid", "{{order.total}}"], ["Ticket", "{{ticket.code}}"]],
    cta: "View your order",
    secondary: { label: "Add to calendar", url: "{{event.calendarUrl}}" },
  }),
  seed("event_online_access", "events", "Online access", "Your online access for {{event.name}}", {
    eyebrow: "Online access",
    heading: "Your event link is ready",
    intro: "Hi {{contact.name}}, use the secure link below to join {{event.name}} when it starts.",
    accent: "#F93D0A",
    detailsTitle: "Join details",
    details: [["Event", "{{event.name}}"], ["Starts", "{{event.date}} at {{event.startTime}}"], ["Meeting provider", "{{event.meetingProvider}}"]],
    cta: "Join the event",
    ctaUrl: "{{event.attendeeMeetingLink}}",
    note: "This access link is personal to your registration. Please do not forward it.",
  }),
  seed("event_reminder", "events", "Event reminder", "{{event.name}} is coming up", {
    eyebrow: "Coming up",
    heading: "{{event.name}} is almost here",
    intro: "Hi {{contact.name}}, a quick reminder so nothing catches you out on the day.",
    accent: "#7C3AED",
    highlight: { label: "Starts", value: "{{event.date}} at {{event.startTime}}", note: "{{event.location}}" },
    detailsTitle: "Event details",
    details: [["Your ticket", "{{ticket.code}}"], ["Ticket type", "{{ticket.type}}"], ["Doors open", "{{event.startTime}}"]],
    cta: "View event details",
    secondary: { label: "Get directions", url: "{{event.mapUrl}}" },
    note: "Plans changed? Let us know so we can free up your place.",
  }),
  seed("event_schedule_update", "events", "Schedule update", "Schedule change for {{event.name}}", {
    eyebrow: "Schedule update",
    heading: "Some details have changed",
    intro: "Hi {{contact.name}}, the schedule for {{event.name}} has been updated. Your ticket stays valid — only the details below have moved.",
    accent: "#F93D0A",
    detailsTitle: "Event details",
    details: [["Event", "{{event.name}}"], ["New date", "{{event.date}}"], ["New time", "{{event.startTime}}"], ["Location", "{{event.location}}"]],
    cta: "See the updated schedule",
    secondary: { label: "Update your calendar", url: "{{event.calendarUrl}}" },
    note: "The new time does not work for you? Reply and we will sort it out.",
  }),
  seed("event_updated", "events", "Event updated", "Updated details for {{event.name}}", {
    eyebrow: "Event update",
    heading: "The event details have been updated",
    intro: "Hi {{contact.name}}, here are the latest details for {{event.name}}.",
    accent: "#F93D0A",
    detailsTitle: "Updated details",
    details: [["Event", "{{event.name}}"], ["Date", "{{event.date}}"], ["Time", "{{event.startTime}}"], ["Location", "{{event.location}}"]],
    cta: "View event details",
    secondary: { label: "Update your calendar", url: "{{event.calendarUrl}}" },
  }),
  seed("event_rescheduled", "events", "Event rescheduled", "{{event.name}} has been rescheduled", {
    eyebrow: "Event rescheduled",
    heading: "Please save the new time",
    intro: "Hi {{contact.name}}, {{event.name}} has a new date or time. Your registration remains valid.",
    accent: "#D97706",
    detailsTitle: "New schedule",
    details: [["Event", "{{event.name}}"], ["Date", "{{event.date}}"], ["Time", "{{event.startTime}}"]],
    cta: "View the new schedule",
    secondary: { label: "Update your calendar", url: "{{event.calendarUrl}}" },
  }),
  seed("event_cancelled", "events", "Event cancelled", "{{event.name}} has been cancelled", {
    eyebrow: "Event cancelled",
    heading: "{{event.name}} will not go ahead",
    intro: "Hi {{contact.name}}, we are sorry to say {{event.name}} has been cancelled. We know this is disappointing, and we did not take the decision lightly.",
    accent: "#B42318",
    detailsTitle: "Event details",
    details: [["Event", "{{event.name}}"], ["Was scheduled for", "{{event.date}}"], ["Your ticket", "{{ticket.code}}"]],
    steps: ["Any payment you made is refunded automatically.", "Refunds usually land within five to ten business days.", "Nothing is needed from you."],
    cta: "View refund status",
    note: "Questions about your refund? Reply to this email and we will help.",
  }),
  seed("event_checkin_confirmation", "events", "Check-in confirmation", "You are checked in for {{event.name}}", {
    eyebrow: "Checked in",
    heading: "Welcome to {{event.name}}",
    intro: "Your ticket has been validated successfully. Enjoy the event.",
    accent: "#0F766E",
    detailsTitle: "Ticket details",
    details: [["Attendee", "{{ticket.holder}}"], ["Ticket type", "{{ticket.type}}"], ["Ticket code", "{{ticket.code}}"]],
    cta: "View event details",
  }),
  seed("event_refund_confirmation", "events", "Refund confirmation", "Your refund for {{event.name}} is confirmed", {
    eyebrow: "Refund confirmed",
    heading: "Your refund is on its way",
    intro: "Hi {{contact.name}}, the refund for your {{event.name}} registration has been initiated.",
    accent: "#0F766E",
    detailsTitle: "Refund details",
    details: [["Event", "{{event.name}}"], ["Order", "{{order.number}}"], ["Refunded", "{{order.total}}"]],
    cta: "View order status",
  }),
  seed("event_waitlist_confirmation", "events", "Waitlist confirmation", "You are on the waitlist for {{event.name}}", {
    eyebrow: "Waitlist",
    heading: "We saved your place",
    intro: "Hi {{contact.name}}, we will let you know if a place becomes available for {{event.name}}.",
    accent: "#7C3AED",
    detailsTitle: "Event details",
    details: [["Event", "{{event.name}}"], ["Date", "{{event.date}}"], ["Location", "{{event.location}}"]],
    cta: "View event details",
  }),
  seed("event_waitlist_promoted", "events", "Waitlist promotion", "A place opened for {{event.name}}", {
    eyebrow: "Place available",
    heading: "You can now attend {{event.name}}",
    intro: "Hi {{contact.name}}, a place has opened and your waitlist registration can now be completed.",
    accent: "#0F766E",
    detailsTitle: "Event details",
    details: [["Event", "{{event.name}}"], ["Date", "{{event.date}}"], ["Location", "{{event.location}}"]],
    cta: "Complete registration",
  }),
  seed("order_confirmation", "payments", "Order confirmation", "Order {{order.number}} confirmed", {
    eyebrow: "Order confirmed",
    heading: "Thanks for your order",
    intro: "Hi {{contact.name}}, we have your order and it is now being prepared. Here is everything for your records.",
    accent: "#0F766E",
    highlight: { label: "Order total", value: "{{order.total}}", note: "Order {{order.number}} · placed {{order.placedAt}}" },
    detailsTitle: "Order summary",
    details: [["Items", "{{order.itemCount}}"], ["Subtotal", "{{order.subtotal}}"], ["Delivery", "{{order.shipping}}"], ["Total paid", "{{order.total}}"]],
    steps: ["We prepare and check your order.", "You get a confirmation when it is on the way.", "Track it any time from your order page."],
    cta: "View your order",
  }),
  seed("order_receipt", "payments", "Order receipt", "Your receipt for order {{order.number}}", {
    eyebrow: "Receipt",
    heading: "Here is your receipt",
    intro: "Thanks {{contact.name}} — this is your receipt for order {{order.number}}. Keep it for your records.",
    accent: "#0F766E",
    highlight: { label: "Amount paid", value: "{{order.total}}", note: "Paid {{order.paidAt}} · {{payment.method}}" },
    detailsTitle: "Order summary",
    details: [["Order", "{{order.number}}"], ["Subtotal", "{{order.subtotal}}"], ["Tax", "{{order.tax}}"], ["Total", "{{order.total}}"], ["Payment method", "{{payment.method}}"]],
    cta: "Download receipt",
    note: "Need a VAT invoice or a change to your billing details? Just reply.",
  }),
  seed("invoice_created", "payments", "Invoice created", "Invoice {{invoice.number}} is ready", {
    eyebrow: "New invoice",
    heading: "Your invoice is ready",
    intro: "Hi {{contact.name}}, invoice {{invoice.number}} is ready to view and pay securely online.",
    accent: "#F93D0A",
    highlight: { label: "Amount due", value: "{{invoice.amount}}", note: "Due {{invoice.dueDate}}" },
    detailsTitle: "Invoice summary",
    details: [["Invoice", "{{invoice.number}}"], ["Issued", "{{invoice.issuedAt}}"], ["Due date", "{{invoice.dueDate}}"], ["Amount due", "{{invoice.amount}}"]],
    cta: "View and pay invoice",
    note: "Paying by bank transfer? The details are on the invoice itself.",
  }),
  seed("invoice_paid", "payments", "Invoice paid", "Invoice {{invoice.number}} is paid", {
    eyebrow: "Payment received",
    heading: "Thank you — that is settled",
    intro: "Hi {{contact.name}}, we received your payment for invoice {{invoice.number}}. Nothing further is owed.",
    accent: "#0F766E",
    highlight: { label: "Amount paid", value: "{{invoice.amount}}", note: "Received {{invoice.paidAt}}" },
    detailsTitle: "Invoice summary",
    details: [["Invoice", "{{invoice.number}}"], ["Amount", "{{invoice.amount}}"], ["Paid on", "{{invoice.paidAt}}"], ["Method", "{{payment.method}}"], ["Balance", "{{invoice.balance}}"]],
    cta: "View receipt",
  }),
  seed("payment_receipt", "payments", "Payment receipt", "Your payment receipt from {{workspace.name}}", {
    eyebrow: "Receipt",
    heading: "Your payment went through",
    intro: "Hi {{contact.name}}, your payment was successful. This email is your receipt.",
    accent: "#0F766E",
    highlight: { label: "Amount", value: "{{payment.amount}}", note: "{{payment.date}} · {{payment.method}}" },
    detailsTitle: "Payment summary",
    details: [["Reference", "{{payment.reference}}"], ["Paid on", "{{payment.date}}"], ["Method", "{{payment.method}}"], ["Amount", "{{payment.amount}}"]],
    cta: "Download receipt",
    note: "Keep this for your records. Reply if you need a different format.",
  }),
  seed("payment_failed", "payments", "Payment failed", "Action needed: your payment did not go through", {
    eyebrow: "Action needed",
    heading: "We could not take your payment",
    intro: "Hi {{contact.name}}, your payment of {{payment.amount}} did not complete. Nothing has been charged, so you have not been billed twice.",
    accent: "#B42318",
    detailsTitle: "Payment details",
    details: [["Amount", "{{payment.amount}}"], ["Attempted", "{{payment.date}}"], ["Reference", "{{payment.reference}}"], ["Reason", "{{payment.failureReason}}"]],
    steps: ["Check the card details and expiry date.", "Make sure the card allows online payments.", "Try again, or use a different card."],
    cta: "Retry payment",
    note: "If it keeps failing, your bank can usually tell you why. We are happy to help too.",
  }),
  seed("refund_issued", "payments", "Refund issued", "Your refund of {{refund.amount}} is on its way", {
    eyebrow: "Refund issued",
    heading: "Your refund is on its way",
    intro: "Hi {{contact.name}}, we have issued your refund. It is now with your bank.",
    accent: "#F93D0A",
    highlight: { label: "Refund amount", value: "{{refund.amount}}", note: "Issued {{refund.issuedAt}} to {{payment.method}}" },
    detailsTitle: "Refund summary",
    details: [["Original order", "{{order.number}}"], ["Refund amount", "{{refund.amount}}"], ["Issued", "{{refund.issuedAt}}"], ["Back to", "{{payment.method}}"]],
    cta: "View refund details",
    note: "Refunds typically appear within five to ten business days, depending on your bank.",
  }),
  seed("document_signature_request", "documents", "Signature request", "{{document.name}} is ready for your signature", {
    eyebrow: "Signature requested",
    heading: "A document needs your signature",
    intro: "Hi {{contact.name}}, {{sender.name}} has sent you {{document.name}} to review and sign. It should only take a minute.",
    accent: "#475569",
    detailsTitle: "Document details",
    details: [["Document", "{{document.name}}"], ["Sent by", "{{sender.name}}"], ["Pages", "{{document.pageCount}}"], ["Sign by", "{{document.dueDate}}"]],
    steps: ["Open the document and read it through.", "Add your signature where indicated.", "Everyone receives a signed copy automatically."],
    cta: "Review and sign",
    note: "This link is unique to you — please do not forward it.",
  }),
  seed("document_signature_reminder", "documents", "Signature reminder", "Reminder: {{document.name}} is waiting for you", {
    eyebrow: "Still waiting",
    heading: "Your signature is still needed",
    intro: "Hi {{contact.name}}, {{document.name}} is still waiting for your signature. We did not want it to slip through the cracks.",
    accent: "#D97706",
    detailsTitle: "Document details",
    details: [["Document", "{{document.name}}"], ["Sent", "{{document.sentAt}}"], ["Sign by", "{{document.dueDate}}"]],
    cta: "Review and sign",
    note: "Already signed it? You can safely ignore this reminder.",
  }),
  seed("document_signed", "documents", "Signature completed", "{{document.name}} is fully signed", {
    eyebrow: "Completed",
    heading: "Everyone has signed",
    intro: "Good news {{contact.name}} — all signatures on {{document.name}} are complete. The final copy is ready.",
    accent: "#0F766E",
    detailsTitle: "Document details",
    details: [["Document", "{{document.name}}"], ["Completed", "{{document.completedAt}}"], ["Signers", "{{document.signerCount}}"]],
    cta: "View signed document",
    note: "A copy is stored in your account and can be downloaded at any time.",
  }),
  seed("campaign_send", "contacts", "Campaign message", "{{campaign.subject}}", {
    eyebrow: "From {{workspace.name}}",
    heading: "Hello {{contact.name}}",
    intro: "{{campaign.message}}",
    accent: "#635BFF",
    cta: "Learn more",
    note: "You are receiving this because you subscribed to updates from {{workspace.name}}. {{unsubscribe.link}}",
  }),
  seed("contact_welcome", "contacts", "Contact welcome", "Welcome to {{workspace.name}}", {
    eyebrow: "Welcome",
    heading: "We are glad you are here",
    intro: "Hi {{contact.name}}, thanks for joining {{workspace.name}}. Here is how to get the most out of it from day one.",
    accent: "#635BFF",
    steps: ["Finish setting up your profile.", "Explore what is available to you.", "Reach out any time — we read every reply."],
    cta: "Get started",
    note: "Not expecting this? You can unsubscribe at any time. {{unsubscribe.link}}",
  }),
  seed("team_invitation", "contacts", "Team invitation", "{{sender.name}} invited you to {{workspace.name}}", {
    eyebrow: "You are invited",
    heading: "Join {{workspace.name}}",
    intro: "{{sender.name}} has invited you to collaborate in {{workspace.name}}. Accept below to set up your access.",
    accent: "#635BFF",
    detailsTitle: "Invitation details",
    details: [["Workspace", "{{workspace.name}}"], ["Invited by", "{{sender.name}}"], ["Your role", "{{invitation.role}}"], ["Expires", "{{invitation.expiresAt}}"]],
    cta: "Accept invitation",
    note: "This invitation is meant for {{contact.email}}. If you were not expecting it, you can ignore this email.",
  }),
  seed("appointment_confirmed", "appointments", "Appointment confirmed", "Your appointment on {{appointment.date}} is confirmed", {
    eyebrow: "Confirmed",
    heading: "Your time is booked",
    intro: "Hi {{contact.name}}, your appointment is confirmed. Here are the details.",
    accent: "#0F766E",
    highlight: { label: "When", value: "{{appointment.date}} at {{appointment.time}}", note: "{{appointment.duration}} with {{appointment.host}}" },
    detailsTitle: "Appointment details",
    details: [["Service", "{{appointment.service}}"], ["With", "{{appointment.host}}"], ["Duration", "{{appointment.duration}}"], ["Where", "{{appointment.location}}"]],
    cta: "View appointment",
    secondary: { label: "Add to calendar", url: "{{appointment.calendarUrl}}" },
    note: "Need to change it? You can reschedule or cancel from the link above.",
  }),
  seed("appointment_reminder_24h", "appointments", "Appointment reminder", "Tomorrow: your appointment at {{appointment.time}}", {
    eyebrow: "Tomorrow",
    heading: "See you tomorrow",
    intro: "Hi {{contact.name}}, this is a friendly reminder about your appointment tomorrow.",
    accent: "#D97706",
    highlight: { label: "When", value: "{{appointment.date}} at {{appointment.time}}", note: "{{appointment.location}}" },
    detailsTitle: "Appointment details",
    details: [["Service", "{{appointment.service}}"], ["With", "{{appointment.host}}"], ["Duration", "{{appointment.duration}}"]],
    cta: "View appointment",
    secondary: { label: "Get directions", url: "{{appointment.mapUrl}}" },
    note: "Cannot make it? Please reschedule so we can offer the slot to someone else.",
  }),
  seed("appointment_rescheduled", "appointments", "Appointment rescheduled", "Your appointment has moved to {{appointment.date}}", {
    eyebrow: "Rescheduled",
    heading: "Your appointment has moved",
    intro: "Hi {{contact.name}}, your appointment has been rescheduled. Here is the new time — nothing else has changed.",
    accent: "#F93D0A",
    highlight: { label: "New time", value: "{{appointment.date}} at {{appointment.time}}", note: "Previously {{appointment.previousDate}}" },
    detailsTitle: "Appointment details",
    details: [["Service", "{{appointment.service}}"], ["With", "{{appointment.host}}"], ["Where", "{{appointment.location}}"]],
    cta: "Confirm new time",
    secondary: { label: "Update calendar", url: "{{appointment.calendarUrl}}" },
    note: "Does the new time not work? Pick another from the link above.",
  }),
  seed("appointment_cancelled", "appointments", "Appointment cancelled", "Your appointment on {{appointment.date}} was cancelled", {
    eyebrow: "Cancelled",
    heading: "Your appointment was cancelled",
    intro: "Hi {{contact.name}}, your appointment has been cancelled and the slot released. You have not been charged.",
    accent: "#B42318",
    detailsTitle: "Appointment details",
    details: [["Service", "{{appointment.service}}"], ["Was booked for", "{{appointment.date}} at {{appointment.time}}"], ["With", "{{appointment.host}}"]],
    cta: "Book another time",
    note: "Cancelled by mistake? You can rebook the same service in a couple of clicks.",
  }),
  seed("workflow_thank_you", "workflows", "Thank-you email", "Thank you from {{workspace.name}}", {
    eyebrow: "Thank you",
    heading: "We appreciate you",
    intro: "Hi {{contact.name}}, thank you for taking the time to connect with us. Here is what happens next.",
    accent: "#635BFF",
    steps: ["We review what you shared.", "You hear back from us shortly.", "Reply any time if something changes."],
    cta: "Continue",
  }),
  seed("workflow_welcome", "workflows", "Welcome email", "Welcome to {{workspace.name}}", {
    eyebrow: "Welcome",
    heading: "A warm welcome, {{contact.name}}",
    intro: "We are glad to have you with us. Here is a short path to getting value from day one.",
    accent: "#635BFF",
    steps: ["Set up the essentials.", "Try the one thing most people start with.", "Ask us anything — we read every reply."],
    cta: "Get started",
    note: "You can unsubscribe from these at any time. {{unsubscribe.link}}",
  }),
  seed("workflow_follow_up", "workflows", "Follow-up email", "A quick follow-up from {{workspace.name}}", {
    eyebrow: "Following up",
    heading: "Just checking in",
    intro: "Hi {{contact.name}}, we wanted to follow up and make sure you have everything you need. No action is required — this is simply a nudge.",
    accent: "#F93D0A",
    cta: "View details",
    note: "Replying to this email reaches a person, not an inbox that nobody reads.",
  }),
  seed("workflow_reminder", "workflows", "Reminder email", "A friendly reminder from {{workspace.name}}", {
    eyebrow: "Reminder",
    heading: "One thing is waiting for you",
    intro: "Hi {{contact.name}}, this is a friendly reminder about the next step waiting on your side.",
    accent: "#D97706",
    detailsTitle: "Reminder details",
    details: [["What", "{{reminder.subject}}"], ["Due", "{{reminder.dueDate}}"]],
    cta: "Take the next step",
    note: "Already handled it? You can ignore this reminder.",
  }),
  seed("workflow_announcement", "workflows", "Announcement", "An update from {{workspace.name}}", {
    eyebrow: "Announcement",
    heading: "There is something new",
    intro: "Hi {{contact.name}}, we have an update we think is worth your time. Here is the short version.",
    accent: "#635BFF",
    steps: ["What changed and why it matters.", "What you need to do, if anything.", "Where to go if you have questions."],
    cta: "Read the update",
    note: "You are receiving this because you subscribed to product updates. {{unsubscribe.link}}",
  }),
  seed("workflow_custom", "workflows", "Simple message", "A message from {{workspace.name}}", {
    eyebrow: "Message",
    heading: "Hello {{contact.name}}",
    intro: "{{message}}",
    accent: "#635BFF",
    cta: "View details",
  }),
  // Workspace membership. These carry sign-in details, so two of them show a
  // password: the value is rendered from the variables at send time and is
  // never stored on the template or in the delivery log's own copy of it.
  seed("member_credentials", "members", "Member sign-in details", "Your sign-in details for {{workspace.name}}", {
    eyebrow: "Workspace access",
    heading: "You have been added to {{workspace.name}}",
    intro: "Hi {{member.name}}, an account has been created for you. Sign in with the details below — you can use either your username or your email address.",
    accent: "#F93D0A",
    highlight: {
      label: "{{member.passwordLabel}}",
      value: "{{member.password}}",
      note: "Keep this somewhere safe. You can change it from Settings once you are in.",
    },
    detailsTitle: "Your account",
    details: [
      ["Username", "{{member.username}}"],
      ["Email", "{{member.email}}"],
      ["Role", "{{member.role}}"],
      ["What you can open", "{{member.tabs}}"],
    ],
    steps: [
      "Sign in with your username or email address.",
      "Choose a password of your own from Settings.",
      "You will only see the parts of the workspace listed above.",
    ],
    cta: "Sign in",
    ctaUrl: "{{workspace.signInUrl}}",
    note: "If you were not expecting this, you can ignore this message and nothing will happen.",
  }),
  seed("member_password_reset", "members", "Member password reset", "New sign-in details for {{workspace.name}}", {
    eyebrow: "New password",
    heading: "Your password has been reset",
    intro: "Hi {{member.name}}, an administrator issued a new password for your {{workspace.name}} account. The previous one no longer works.",
    accent: "#D97706",
    highlight: {
      label: "{{member.passwordLabel}}",
      value: "{{member.password}}",
      note: "Change it from Settings once you have signed in.",
    },
    detailsTitle: "Your account",
    details: [
      ["Username", "{{member.username}}"],
      ["Email", "{{member.email}}"],
    ],
    cta: "Sign in",
    ctaUrl: "{{workspace.signInUrl}}",
    note: "Did not ask for this? Speak to whoever runs your workspace — it was issued by an administrator, not by you.",
  }),
  seed("member_workspace_access", "members", "Workspace access granted", "You now have access to {{workspace.name}}", {
    eyebrow: "Workspace access",
    heading: "You now have access to {{workspace.name}}",
    intro: "Hi {{member.name}}, your existing MaxForm account has been added to this workspace. Sign in with the password you already use — nothing about it has changed.",
    accent: "#0F766E",
    detailsTitle: "Your access",
    details: [
      ["Workspace", "{{workspace.name}}"],
      ["Role", "{{member.role}}"],
      ["What you can open", "{{member.tabs}}"],
    ],
    cta: "Open workspace",
    ctaUrl: "{{workspace.signInUrl}}",
    note: "You will only see the parts of the workspace listed above.",
  }),
  seed("member_access_changed", "members", "Member access changed", "Your access to {{workspace.name}} has changed", {
    eyebrow: "Access updated",
    heading: "Your access has been updated",
    intro: "Hi {{member.name}}, an administrator changed what you can reach in {{workspace.name}}. The list below is what applies from now on.",
    accent: "#6D28D9",
    detailsTitle: "Your access",
    details: [
      ["Role", "{{member.role}}"],
      ["What you can open", "{{member.tabs}}"],
    ],
    cta: "Open workspace",
    ctaUrl: "{{workspace.signInUrl}}",
    note: "Nothing you have already created has been removed.",
  }),
  seed("member_suspended", "members", "Member access suspended", "Your access to {{workspace.name}} is paused", {
    eyebrow: "Access paused",
    heading: "Your access has been suspended",
    intro: "Hi {{member.name}}, your access to {{workspace.name}} has been paused by an administrator. You can still sign in, but the workspace will be closed to you until it is restored.",
    accent: "#B42318",
    detailsTitle: "What this means",
    details: [
      ["Workspace", "{{workspace.name}}"],
      ["Your account", "Still active"],
    ],
    note: "Speak to whoever runs the workspace if you think this is a mistake.",
  }),
  seed("member_removed", "members", "Member removed", "Your access to {{workspace.name}} has ended", {
    eyebrow: "Access ended",
    heading: "You have been removed from {{workspace.name}}",
    intro: "Hi {{member.name}}, your access to {{workspace.name}} has ended. Anything you created stays with the workspace.",
    accent: "#475467",
    note: "This does not delete your MaxForm account. If you think this is a mistake, speak to whoever runs the workspace.",
  }),
] as const;

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new WorkspaceEmailError(
      "Email settings are temporarily unavailable. Please try again shortly.",
      503,
      "email_unavailable",
    );
  }
  return neon(url);
};

const isProvider = (value: string): value is EmailProviderId =>
  Object.prototype.hasOwnProperty.call(emailProviderSchemas, value);

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const cleanText = (value: unknown, max = 2_000) =>
  Array.from(String(value ?? "")).filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 0x20 && code !== 0x7f;
  }).join("").trim().slice(0, max);

const safeUuidList = (value: unknown, max = 100) => {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
        try {
          const parsed = JSON.parse(value) as unknown;
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })()
      : [];
  return Array.from(new Set(values
    .map((item) => cleanText(item, 64))
    .filter(isUuid)))
    .slice(0, max);
};

const emailErrorSecretPattern = /(?:MAXFORM_[A-Z0-9_]+|EMAIL_ENCRYPTION_KEY|DATABASE_URL|SUPABASE_|INTEGRATION_ENCRYPTION_KEY|PAYMENT_ENCRYPTION_KEY|\b(?:api[_ -]?key|server token|secret(?: access)? key|password|authorization|bearer)\b|https?:\/\/|node_modules|\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT)\b|\bat\s+.+\(.*:\d+:\d+\)|\{\s*["']?\w+["']?\s*:)/i;
const emailErrorUserMessagePattern = /^(?:A |An |Check |Choose |Connect |Custom |Email |Enter |Inbound |Managed |MaxForm |No |Only |Provider |Reconnect |Secure |The |This |Use |We |Your )/i;

/** Keep persisted and API-facing email errors useful without exposing provider
 * responses, credentials, environment names, URLs, or stack details. */
export const publicEmailErrorMessage = (value: unknown, fallback = "The email provider needs attention.") => {
  const message = cleanText(value, 320).replace(/\s+/g, " ").trim();
  const sanitized = message.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "your email address");
  if (!sanitized || emailErrorSecretPattern.test(sanitized) || sanitized.length > 240 || !emailErrorUserMessagePattern.test(sanitized)) return fallback;
  return sanitized;
};

const validEmail = (value: string) =>
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && !/[\r\n]/.test(value);
const validDomain = (value: string) =>
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);

const senderEmail = (from: string) => {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim();
};

const senderAddress = (from: string) => {
  const value = cleanText(from, 500);
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  const email = senderEmail(value);
  return {
    email,
    name: match?.[1]?.replace(/^['"]|['"]$/g, "").trim() || undefined,
  };
};

const senderDomain = (from: string) => senderEmail(from).toLowerCase().split("@")[1] || "";
const managedSenderDomain = () => {
  const configured = cleanText(process.env.MAXFORM_MANAGED_SENDING_DOMAIN, 255).toLowerCase();
  return validDomain(configured) ? configured : "";
};
const managedResendApiKey = () => cleanText(process.env.MAXFORM_MANAGED_RESEND_API_KEY, 500);
const managedSendingConfigured = () => Boolean(managedSenderDomain() && managedResendApiKey());
const managedResendCredentials = (): CredentialRecord => ({
  api_key: managedResendApiKey(),
  access_mode: "send",
});

const verifyManagedSendingConfiguration = async () => {
  if (!managedSendingConfigured()) {
    throw new WorkspaceEmailError(
      "MaxForm Managed Sending is temporarily unavailable. Contact your workspace administrator or choose another connected provider.",
      503,
      "managed_sender_unavailable",
    );
  }
  const domain = managedSenderDomain();
  try {
    const domains = await emailProviderAdapter("resend").getSendingDomains(managedResendCredentials());
    const configuredDomain = domains.find((item) => item.domain.toLowerCase() === domain);
    const providerStatus = cleanText(configuredDomain?.raw?.status, 40).toLowerCase();
    const sendReady = configuredDomain?.status === "verified" || ["verified", "partially_verified"].includes(providerStatus);
    if (!configuredDomain || !sendReady) {
      throw new WorkspaceEmailError(
        `MaxForm Managed Sending cannot be activated because ${domain} is not verified for sending in the configured Resend account.`,
        503,
        "managed_sender_domain_unverified",
      );
    }
  } catch (error) {
    if (error instanceof WorkspaceEmailError) throw error;
    const safe = providerUserError(error, "The configured MaxForm Resend account could not be verified.");
    throw new WorkspaceEmailError(
      "MaxForm Managed Sending could not verify its Resend API key and sending domain. Check the server configuration and try again.",
      503,
      "managed_sender_verification_failed",
      safe.retryable,
      safe.detail,
    );
  }
};

const auditProviderChange = async (
  sql: ReturnType<typeof database>,
  userId: string,
  provider: EmailProviderId,
  mode: EmailProviderMode,
  action: "connected" | "activated" | "deactivated" | "disconnected" | "health_check",
  detail: Record<string, unknown> = {},
) => {
  try {
    await sql.query(
      `INSERT INTO email_provider_audit_logs (user_id, provider, mode, action, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [userId, provider, mode, action, JSON.stringify(detail)],
    );
  } catch {
    // Audit logging must never prevent a provider from connecting or sending.
  }
};

type ActiveDelivery = {
  provider: EmailProviderId;
  mode: EmailProviderMode;
  connection?: DatabaseRow;
};

const activeDelivery = async (sql: ReturnType<typeof database>, userId: string): Promise<ActiveDelivery | null> => {
  const settingsRows = await sql.query(
    `SELECT active_provider, active_provider_mode, managed_sending_enabled
     FROM email_settings WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const settings = settingsRows[0] as DatabaseRow | undefined;
  const configuredProvider = cleanText(settings?.active_provider, 32);
  const configuredMode: EmailProviderMode = cleanText(settings?.active_provider_mode, 20) === "managed" ? "managed" : "custom";
  if (settings?.managed_sending_enabled === true && configuredMode === "managed" && configuredProvider === "resend") {
    return { provider: "resend", mode: "managed" };
  }
  const provider = isProvider(configuredProvider) ? configuredProvider : "";
  const rows = provider
    ? await sql.query(`SELECT * FROM email_provider_connections WHERE user_id = $1 AND provider = $2 AND status = 'connected' AND (is_active = TRUE OR role = 'primary') LIMIT 1`, [userId, provider])
    : await sql.query(`SELECT * FROM email_provider_connections WHERE user_id = $1 AND status = 'connected' AND (is_active = TRUE OR role = 'primary') LIMIT 1`, [userId]);
  const connection = rows[0] as DatabaseRow | undefined;
  if (!connection) return null;
  return { provider: cleanText(connection.provider, 32) as EmailProviderId, mode: "custom", connection };
};

export type WorkspaceEmailDeliveryState = {
  provider: EmailProviderId;
  mode: EmailProviderMode;
  ready: boolean;
};

export const getWorkspaceEmailDeliveryState = async (
  userId: string,
): Promise<WorkspaceEmailDeliveryState | null> => {
  const active = await activeDelivery(database(), userId);
  if (!active) return null;
  return {
    provider: active.provider,
    mode: active.mode,
    ready: active.mode === "managed"
      ? managedSendingConfigured()
      : active.connection?.health_ok === true && cleanText(active.connection.status, 20) === "connected",
  };
};

const managedSenderUnavailable = () => new WorkspaceEmailError(
  "MaxForm Managed Sending is temporarily unavailable. Contact your workspace administrator or choose another connected provider.",
  503,
  "managed_sender_unavailable",
);

const customDomainUnverified = (_domain: string) => new WorkspaceEmailError(
  "This sender domain is not verified. Switch to MaxForm Managed Sending or verify your domain.",
  422,
  "custom_domain_unverified",
);

const resendSenderDomainError = (from: string) => {
  const domain = senderDomain(from) || "the sender domain";
  return new WorkspaceEmailError(
    `Resend cannot send from ${domain} yet. Verify the sending domain in Resend, or choose Custom SMTP for a mailbox sender.`,
    422,
    "sender_domain_unverified",
  );
};

const resendSandboxError = () => new WorkspaceEmailError(
  "Resend's onboarding@resend.dev sender is test-only and can deliver only to the email address on the Resend account. Verify a domain for real recipients, or connect Gmail/Google Workspace through Custom SMTP.",
  422,
  "provider_sandbox_restriction",
);

const credentialKeys = () => {
  const dedicated = process.env.EMAIL_ENCRYPTION_KEY || "";
  if (process.env.NODE_ENV === "production" && dedicated.length < 24) {
    throw new WorkspaceEmailError(
      "A dedicated email encryption key must be configured in production.",
      503,
      "encryption_unavailable",
    );
  }
  const secrets = [
    dedicated,
    process.env.PAYMENT_ENCRYPTION_KEY || "",
    process.env.INTEGRATION_ENCRYPTION_KEY || "",
  ].filter(
    (secret, index, values) => secret.length >= 24 && values.indexOf(secret) === index,
  );
  if (!secrets.length) {
    throw new WorkspaceEmailError(
      "Secure email connections are temporarily unavailable.",
      503,
      "encryption_unavailable",
    );
  }
  return secrets.map((secret) => createHash("sha256").update(secret).digest());
};

const encryptCredentials = (credentials: CredentialRecord) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKeys()[0], iv);
  const payload = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    payload.toString("base64url"),
  ].join(".");
};

const decryptCredentials = (value: string): CredentialRecord => {
  const [iv, tag, payload] = value.split(".");
  if (!iv || !tag || !payload) throw new WorkspaceEmailError("This provider must be reconnected.", 409);
  for (const key of credentialKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(payload, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      ) as CredentialRecord;
    } catch {
      // Permit a retained previous key during a deliberate credential rotation.
    }
  }
  throw new WorkspaceEmailError("This provider must be reconnected.", 409);
};

const providerHint = (provider: EmailProviderId, credentials: CredentialRecord) => {
  const secret = credentials.api_key || credentials.server_token || credentials.username || credentials.access_key_id || "";
  const suffix = secret ? secret.slice(-4).padStart(4, "•") : "••••";
  return provider === "smtp" ? `${credentials.host}:${credentials.port}` : `${emailProviderSchemas[provider].name} · ${suffix}`;
};

const normaliseCredentials = (provider: EmailProviderId, value: CredentialRecord) => {
  const credentials: CredentialRecord = {};
  for (const field of emailProviderSchemas[provider].fields) {
    const raw = cleanText(value[field.key], 2_000);
    const resolved = raw || field.default || "";
    if (!resolved) throw new WorkspaceEmailError(`${field.label} is required.`, 400, "invalid_provider_credentials");
    if (field.type === "select" && !field.options?.includes(resolved)) throw new WorkspaceEmailError(`Choose a valid ${field.label.toLowerCase()}.`, 400, "invalid_provider_credentials");
    credentials[field.key] = resolved;
  }
  return credentials;
};

const providerUserError = (error: unknown, fallback = "Email could not be sent. Please try again.") => {
  if (error instanceof WorkspaceEmailError) return error;
  if (error instanceof EmailAdapterError) {
    if (/only send testing emails|testing emails to your own email address|onboarding@resend\.dev/i.test(error.message)) return resendSandboxError();
    if (/domain is not verified|verify your domain|sender identity|from address/i.test(`${error.message} ${error.detail}`)) return new WorkspaceEmailError("This sender domain is not verified. Switch to MaxForm Managed Sending or verify your domain.", 422, "sender_domain_unverified", false, error.detail);
    if (error.code === "provider_credentials_invalid") return new WorkspaceEmailError("Your email provider credentials are invalid. Please reconnect.", 422, "provider_credentials_invalid", false, error.detail);
    return new WorkspaceEmailError(fallback, error.status >= 500 ? 502 : error.status, error.code, error.retryable, error.detail);
  }
  return new WorkspaceEmailError(fallback, 502, "provider_request_failed", true, error instanceof Error ? error.message : String(error));
};

export const verifyEmailProvider = async (provider: EmailProviderId, credentials: CredentialRecord) => {
  const adapter = emailProviderAdapter(provider);
  await adapter.validateCredentials(credentials);
  return true;
};

type DeliveryInput = {
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

const sendWithProvider = async (provider: EmailProviderId, credentials: CredentialRecord, input: DeliveryInput) => {
  const adapter = emailProviderAdapter(provider);
  const from = senderAddress(input.from);
  return adapter.sendEmail(credentials, {
    from,
    replyTo: input.replyTo,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: input.headers,
  });
};

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
const plainText = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const resolveVariable = (variables: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((current, segment) => current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : "", variables);
const render = (template: string, variables: Record<string, unknown>, html = false) => template.replace(/\{\{#if\s+([^}]+?)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_match, key: string, body: string) => {
  const value = resolveVariable(variables, key.trim());
  return value === false || value === null || value === undefined || value === "" ? "" : body;
}).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => {
  const value = resolveVariable(variables, key.trim());
  const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  return html ? escapeHtml(text) : text.replace(/[\r\n]/g, " ");
});

export const ensureEmailWorkspace = async (userId: string) => {
  const sql = database();
  await sql`INSERT INTO email_settings (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
  // Seed/update the built-ins in one request. Sending one database request per
  // template creates a burst of concurrent Neon connections on every settings
  // request and can turn a transient connection timeout into a dashboard-wide
  // email failure.
  const columns = 8;
  const values = templateSeeds.flatMap((template) => [
    userId,
    template[0],
    template[1],
    template[2],
    template[3],
    template[4],
    plainText(template[4]),
    template[5],
  ]);
  const placeholders = templateSeeds.map((_, index) => {
    const start = index * columns + 1;
    return `(${Array.from({ length: columns }, (_value, offset) => `$${start + offset}${offset === columns - 1 ? "::jsonb" : ""}`).join(", ")})`;
  }).join(", ");
  await sql.query(
    `INSERT INTO email_templates (user_id, key, module, name, subject, html_body, text_body, blocks)
     VALUES ${placeholders}
     ON CONFLICT (user_id, key) DO UPDATE
       SET module = EXCLUDED.module,
           name = EXCLUDED.name,
           subject = EXCLUDED.subject,
           html_body = EXCLUDED.html_body,
           text_body = EXCLUDED.text_body,
           blocks = EXCLUDED.blocks,
           updated_at = NOW()
       WHERE email_templates.is_custom = FALSE
         AND (email_templates.subject, email_templates.html_body, email_templates.text_body, email_templates.blocks)
           IS DISTINCT FROM (EXCLUDED.subject, EXCLUDED.html_body, EXCLUDED.text_body, EXCLUDED.blocks)`,
    values,
  );
};

const safeConnection = (row: DatabaseRow) => ({
  id: cleanText(row.id, 64), provider: cleanText(row.provider, 32), mode: cleanText(row.mode, 20) === "managed" ? "managed" : "custom", credentialHint: cleanText(row.credential_hint, 120), role: cleanText(row.role, 16), isActive: row.is_active === true || cleanText(row.role, 16) === "primary", status: cleanText(row.status, 20), healthOk: row.health_ok === true, validationMode: cleanText(row.validation_mode, 20) || "delivery", accessMode: cleanText(row.access_mode, 20) === "send_receive" ? "send_receive" : "send", lastHealthCheckAt: row.last_health_check_at || null, lastVerifiedAt: row.last_verified_at || null, lastError: row.last_error ? publicEmailErrorMessage(row.last_error) : "", createdAt: row.created_at || null, inboundEnabled: Boolean(cleanText(row.inbound_token_hash, 128)), eventsEnabled: Boolean(cleanText(row.event_token_hash, 128)),
});
const identityMode = (row: DatabaseRow) => cleanText(row.sending_mode, 20) === "custom" ? "custom" : "managed";
const managedDomainForIdentity = (row: DatabaseRow) => managedSenderDomain() || cleanText(row.managed_domain, 255).toLowerCase();
const managedPrefixForIdentity = (row: DatabaseRow) => {
  const stored = cleanText(row.sender_prefix, 63).toLowerCase();
  if (!managedSenderPrefixError(stored)) return stored;
  return normalizeManagedSenderPrefix(row.sender_name) || "maxform";
};
const generatedManagedSenderForIdentity = (row: DatabaseRow) => {
  const domain = managedDomainForIdentity(row);
  const generated = cleanText(row.generated_sender_email, 320).toLowerCase();
  if (validEmail(generated) && senderDomain(generated) === domain) return generated;
  return managedSenderEmail(managedPrefixForIdentity(row), domain);
};
const customSenderForIdentity = (row: DatabaseRow) => {
  return resolveStoredCustomSenderEmail(
    row.custom_sender_email,
    row.sender_email,
    [
    generatedManagedSenderForIdentity(row),
    cleanText(row.generated_sender_email, 320).toLowerCase(),
    cleanText(row.managed_sender_email, 320).toLowerCase(),
    ],
  );
};
const identityEffectiveSender = (row: DatabaseRow) => {
  if (identityMode(row) === "custom") return customSenderForIdentity(row);
  return generatedManagedSenderForIdentity(row);
};
const identitySenderReady = (row: DatabaseRow) => identityMode(row) === "custom"
  ? validEmail(identityEffectiveSender(row)) && row.domain_verified === true
  : validEmail(identityEffectiveSender(row));
const identitySenderError = (row: DatabaseRow) => {
  if (identitySenderReady(row)) return "";
  if (identityMode(row) === "custom") return customDomainUnverified(cleanText(row.custom_domain || row.domain, 255) || "this domain").message;
  return managedSenderUnavailable().message;
};
const safeIdentity = (row: DatabaseRow) => {
  const mode = identityMode(row);
  const effectiveSender = identityEffectiveSender(row);
  const managedDomain = managedDomainForIdentity(row);
  const managedPrefix = managedPrefixForIdentity(row);
  const generatedSenderEmail = managedSenderEmail(managedPrefix, managedDomain);
  return {
    id: cleanText(row.id, 64),
    senderName: cleanText(row.sender_name, 160),
    senderEmail: effectiveSender,
    replyTo: cleanText(row.reply_to, 320),
    sendingMode: mode,
    senderPrefix: mode === "managed" ? managedPrefix : "",
    managedDomain: mode === "managed" ? managedDomain : "",
    generatedSenderEmail: mode === "managed" ? generatedSenderEmail : "",
    managedSenderEmail: mode === "managed" ? generatedSenderEmail : "",
    customSenderEmail: mode === "custom" ? customSenderForIdentity(row) : cleanText(row.custom_sender_email, 320).toLowerCase(),
    customDomain: cleanText(row.custom_domain || (mode === "custom" ? row.domain : ""), 255),
    domainVerified: row.domain_verified === true,
    domainVerificationStatus: cleanText(row.domain_verification_status, 24) || (mode === "managed" ? "not_required" : "pending"),
    senderReady: identitySenderReady(row),
    senderError: identitySenderError(row),
    status: cleanText(row.status, 20),
    isDefault: row.is_default === true,
    updatedAt: row.updated_at || null,
  };
};
const safeTemplate = (row: DatabaseRow) => ({
  id: cleanText(row.id, 64), key: cleanText(row.key, 100), module: cleanText(row.module, 40), name: cleanText(row.name, 160), subject: cleanText(row.subject, 500), htmlBody: String(row.html_body || ""), textBody: String(row.text_body || ""), blocks: Array.isArray(row.blocks) ? row.blocks : [], identityId: row.identity_id ? cleanText(row.identity_id, 64) : null, isCustom: row.is_custom === true, updatedAt: row.updated_at || null,
});
const safeSendingDomain = (row: DatabaseRow) => ({
  id: cleanText(row.id, 64), provider: cleanText(row.provider, 32), domain: cleanText(row.domain, 255), providerDomainId: cleanText(row.provider_domain_id, 160), status: cleanText(row.status, 20), records: Array.isArray(row.dns_records) ? row.dns_records : [], lastError: row.last_error ? publicEmailErrorMessage(row.last_error) : "", lastCheckedAt: row.last_checked_at || null, verifiedAt: row.verified_at || null, createdAt: row.created_at || null,
});
const safeLog = (row: DatabaseRow) => ({
  id: cleanText(row.id, 64), templateKey: cleanText(row.template_key, 100), module: cleanText(row.module, 40), provider: cleanText(row.provider, 32), recipient: cleanText(row.recipient, 320), subject: cleanText(row.subject, 500), status: cleanText(row.status, 24), providerMessageId: cleanText(row.provider_message_id, 255), attemptCount: Number(row.attempt_count || 0), error: row.last_error ? publicEmailErrorMessage(row.last_error, "This delivery needs attention.") : "", createdAt: row.created_at || null, sentAt: row.sent_at || null,
  relatedTicketIds: safeUuidList(row.related_ticket_ids),
});
const safeInboundMessage = (row: DatabaseRow) => ({
  id: cleanText(row.id, 64),
  provider: cleanText(row.provider, 32),
  sender: cleanText(row.sender, 320),
  recipient: cleanText(row.recipient, 320),
  subject: cleanText(row.subject, 500),
  htmlBody: String(row.html_body || ""),
  textBody: String(row.text_body || ""),
  status: cleanText(row.status, 24),
  receivedAt: row.received_at || null,
});

export const getEmailWorkspace = async (userId: string, filters: { status?: string; search?: string } = {}) => {
  await ensureEmailWorkspace(userId);
  const sql = database();
  const status = cleanText(filters.status, 24);
  const search = cleanText(filters.search, 160).toLowerCase();
  const [connections, identities, templates, logs, received, domains, settingsRows, overviewRows, suppressions] = await Promise.all([
    sql.query(`SELECT
      id,
      provider,
      mode,
      credential_hint,
      role,
      is_active,
      status,
      health_ok,
      validation_mode,
      access_mode,
      last_health_check_at,
      last_verified_at,
      last_error,
      COALESCE(to_jsonb(email_provider_connections)->>'inbound_token_hash', '') AS inbound_token_hash,
      COALESCE(to_jsonb(email_provider_connections)->>'event_token_hash', '') AS event_token_hash,
      created_at
      FROM email_provider_connections
      WHERE user_id = $1
      ORDER BY created_at`, [userId]),
    sql.query(`SELECT * FROM email_identities WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC`, [userId]),
    sql.query(`SELECT * FROM email_templates WHERE user_id = $1 AND key NOT LIKE 'event_override_%' ORDER BY module, name`, [userId]),
    sql.query(`SELECT * FROM email_logs WHERE user_id = $1 AND ($2 = '' OR status = $2) AND ($3 = '' OR LOWER(recipient) LIKE '%' || $3 || '%' OR LOWER(subject) LIKE '%' || $3 || '%') ORDER BY created_at DESC LIMIT 200`, [userId, status, search]),
    sql.query(`SELECT * FROM email_inbound_messages WHERE user_id = $1 AND ($2 = '' OR LOWER(sender) LIKE '%' || $2 || '%' OR LOWER(subject) LIKE '%' || $2 || '%') ORDER BY received_at DESC LIMIT 200`, [userId, search]),
    sql.query(`SELECT * FROM email_sending_domains WHERE user_id = $1 ORDER BY updated_at DESC, domain ASC`, [userId]),
    sql.query(`SELECT * FROM email_settings WHERE user_id = $1 LIMIT 1`, [userId]),
    sql.query(`SELECT COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS sent_30d, COUNT(*) FILTER (WHERE status IN ('bounced', 'complained') AND created_at >= NOW() - INTERVAL '30 days')::int AS negative_30d, COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '30 days')::int AS failed_30d, COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked') AND created_at >= NOW() - INTERVAL '30 days')::int AS delivered_30d FROM email_logs WHERE user_id = $1`, [userId]),
    sql.query(`SELECT COUNT(*)::int AS count FROM email_suppressions WHERE user_id = $1`, [userId]),
  ]);
  const settings = settingsRows[0] as DatabaseRow;
  const overview = overviewRows[0] as DatabaseRow;
  const configuredActiveProvider = cleanText(settings?.active_provider, 32);
  const configuredActiveMode: EmailProviderMode = cleanText(settings?.active_provider_mode, 20) === "managed" ? "managed" : "custom";
  const managedSendingEnabled = settings?.managed_sending_enabled === true;
  const connectedActive = (connections as DatabaseRow[]).filter((row) => cleanText(row.status, 20) === "connected" && (row.is_active === true || cleanText(row.role, 16) === "primary"));
  const configuredCustomActive = configuredActiveMode === "custom"
    ? connectedActive.find((row) => cleanText(row.provider, 32) === configuredActiveProvider)
    : undefined;
  const fallbackActive = configuredCustomActive || connectedActive[0];
  const activeProvider = managedSendingEnabled && configuredActiveMode === "managed" && configuredActiveProvider === "resend"
    ? { provider: "resend" as EmailProviderId, mode: "managed" as const }
    : fallbackActive
      ? { provider: cleanText(fallbackActive.provider, 32) as EmailProviderId, mode: "custom" as const }
      : null;
  const managedConnection = {
    id: "managed-resend",
    provider: "resend" as const,
    mode: "managed" as const,
    credentialHint: "MaxForm verified account",
    role: activeProvider?.provider === "resend" && activeProvider.mode === "managed" ? "primary" as const : "none" as const,
    isActive: activeProvider?.provider === "resend" && activeProvider.mode === "managed",
    status: managedSendingEnabled ? managedSendingConfigured() ? "connected" as const : "attention" as const : "disconnected" as const,
    healthOk: managedSendingEnabled && managedSendingConfigured(),
    validationMode: "api" as const,
    accessMode: "send" as const,
    lastHealthCheckAt: null,
    lastVerifiedAt: managedSendingEnabled && managedSendingConfigured() ? new Date().toISOString() : null,
    lastError: managedSendingEnabled && !managedSendingConfigured() ? "MaxForm Managed Sending is temporarily unavailable. Contact your workspace administrator or choose another connected provider." : "",
    createdAt: null,
    inboundEnabled: false,
    eventsEnabled: false,
  };
  return {
    managedSendingDomain: managedSenderDomain(),
    managedSendingConfigured: Boolean(managedSenderDomain() && managedResendApiKey()),
    activeProvider,
    managedConnection,
    // Managed Sending is represented separately so a custom Resend account can
    // coexist without provider-id collisions in cards, webhooks, or selectors.
    connections: connections.map((row) => safeConnection(row as DatabaseRow)),
    identities: identities.map((row) => safeIdentity(row as DatabaseRow)),
    domains: domains.map((row) => safeSendingDomain(row as DatabaseRow)),
    templates: templates.map((row) => safeTemplate(row as DatabaseRow)),
    logs: logs.map((row) => safeLog(row as DatabaseRow)),
    received: received.map((row) => safeInboundMessage(row as DatabaseRow)),
    settings: { defaultIdentityId: settings?.default_identity_id || null, rateLimitPerHour: Number(settings?.rate_limit_per_hour || 600), suppressionThreshold: Number(settings?.suppression_threshold || 5), suppressionBehavior: cleanText(settings?.suppression_behavior, 32) || "suppress" },
    overview: { sent30d: Number(overview?.sent_30d || 0), negative30d: Number(overview?.negative_30d || 0), failed30d: Number(overview?.failed_30d || 0), delivered30d: Number(overview?.delivered_30d || 0), suppressions: Number((suppressions[0] as DatabaseRow | undefined)?.count || 0) },
  };
};

const analyticsWindowDays = (value: number) => [7, 30, 90, 365].includes(value) ? value : 30;
const analyticsCount = (row: DatabaseRow | undefined, key: string) => Number(row?.[key] || 0);
const analyticsRate = (value: number, total: number) => total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0;

export const getEmailAnalytics = async (userId: string, requestedDays = 30) => {
  await ensureEmailWorkspace(userId);
  const days = analyticsWindowDays(requestedDays);
  const sql = database();
  const since = `CURRENT_DATE - ($2::int - 1)`;
  const [summaryRows, trendRows, providerRows, templateRows, moduleRows] = await Promise.all([
    sql.query(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
      COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked'))::int AS accepted,
      COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
      COUNT(*) FILTER (WHERE status = 'opened')::int AS opened,
      COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked,
      COUNT(*) FILTER (WHERE status = 'bounced')::int AS bounced,
      COUNT(*) FILTER (WHERE status = 'complained')::int AS complained,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM email_logs WHERE user_id = $1 AND created_at >= ${since}`,
    [userId, days]),
    sql.query(`WITH calendar AS (
        SELECT generate_series((CURRENT_DATE - ($2::int - 1))::timestamp, CURRENT_DATE::timestamp, INTERVAL '1 day')::date AS day
      ), daily AS (
        SELECT created_at::date AS day,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked'))::int AS accepted,
          COUNT(*) FILTER (WHERE status = 'opened')::int AS opened,
          COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked,
          COUNT(*) FILTER (WHERE status IN ('bounced', 'complained', 'failed'))::int AS failed
        FROM email_logs WHERE user_id = $1 AND created_at >= CURRENT_DATE - ($2::int - 1)
        GROUP BY created_at::date
      ) SELECT TO_CHAR(calendar.day, 'YYYY-MM-DD') AS date,
          COALESCE(daily.total, 0)::int AS total,
          COALESCE(daily.accepted, 0)::int AS accepted,
          COALESCE(daily.opened, 0)::int AS opened,
          COALESCE(daily.clicked, 0)::int AS clicked,
          COALESCE(daily.failed, 0)::int AS failed
        FROM calendar LEFT JOIN daily USING (day) ORDER BY calendar.day`,
    [userId, days]),
    sql.query(`SELECT COALESCE(NULLIF(provider, ''), 'Unassigned') AS provider,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked'))::int AS accepted,
      COUNT(*) FILTER (WHERE status = 'opened')::int AS opened,
      COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked,
      COUNT(*) FILTER (WHERE status IN ('bounced', 'complained', 'failed'))::int AS failed
      FROM email_logs WHERE user_id = $1 AND created_at >= ${since}
      GROUP BY COALESCE(NULLIF(provider, ''), 'Unassigned') ORDER BY total DESC, provider ASC LIMIT 8`,
    [userId, days]),
    sql.query(`SELECT COALESCE(NULLIF(template_key, ''), 'custom_message') AS template_key,
      COALESCE(NULLIF(module, ''), 'workflows') AS module,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked'))::int AS accepted,
      COUNT(*) FILTER (WHERE status = 'opened')::int AS opened,
      COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked,
      COUNT(*) FILTER (WHERE status IN ('bounced', 'complained', 'failed'))::int AS failed
      FROM email_logs WHERE user_id = $1 AND created_at >= ${since}
      GROUP BY COALESCE(NULLIF(template_key, ''), 'custom_message'), COALESCE(NULLIF(module, ''), 'workflows')
      ORDER BY total DESC, template_key ASC LIMIT 8`,
    [userId, days]),
    sql.query(`SELECT COALESCE(NULLIF(module, ''), 'workflows') AS module,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked'))::int AS accepted,
      COUNT(*) FILTER (WHERE status IN ('bounced', 'complained', 'failed'))::int AS failed
      FROM email_logs WHERE user_id = $1 AND created_at >= ${since}
      GROUP BY COALESCE(NULLIF(module, ''), 'workflows') ORDER BY total DESC, module ASC`,
    [userId, days]),
  ]);
  const summary = summaryRows[0] as DatabaseRow | undefined;
  const total = analyticsCount(summary, "total");
  const accepted = analyticsCount(summary, "accepted");
  const opened = analyticsCount(summary, "opened");
  const clicked = analyticsCount(summary, "clicked");
  const risk = analyticsCount(summary, "bounced") + analyticsCount(summary, "complained");
  const failed = analyticsCount(summary, "failed");
  return {
    rangeDays: days,
    generatedAt: new Date().toISOString(),
    totals: { total, queued: analyticsCount(summary, "queued"), accepted, delivered: analyticsCount(summary, "delivered"), opened, clicked, bounced: analyticsCount(summary, "bounced"), complained: analyticsCount(summary, "complained"), failed },
    rates: { acceptance: analyticsRate(accepted, total), open: analyticsRate(opened, accepted), click: analyticsRate(clicked, accepted), risk: analyticsRate(risk, total), failure: analyticsRate(failed, total) },
    trend: trendRows.map((row) => ({ date: cleanText((row as DatabaseRow).date, 16), total: analyticsCount(row as DatabaseRow, "total"), accepted: analyticsCount(row as DatabaseRow, "accepted"), opened: analyticsCount(row as DatabaseRow, "opened"), clicked: analyticsCount(row as DatabaseRow, "clicked"), failed: analyticsCount(row as DatabaseRow, "failed") })),
    providers: providerRows.map((row) => ({ provider: cleanText((row as DatabaseRow).provider, 64), total: analyticsCount(row as DatabaseRow, "total"), accepted: analyticsCount(row as DatabaseRow, "accepted"), opened: analyticsCount(row as DatabaseRow, "opened"), clicked: analyticsCount(row as DatabaseRow, "clicked"), failed: analyticsCount(row as DatabaseRow, "failed") })),
    templates: templateRows.map((row) => ({ key: cleanText((row as DatabaseRow).template_key, 100), module: cleanText((row as DatabaseRow).module, 40), total: analyticsCount(row as DatabaseRow, "total"), accepted: analyticsCount(row as DatabaseRow, "accepted"), opened: analyticsCount(row as DatabaseRow, "opened"), clicked: analyticsCount(row as DatabaseRow, "clicked"), failed: analyticsCount(row as DatabaseRow, "failed") })),
    modules: moduleRows.map((row) => ({ module: cleanText((row as DatabaseRow).module, 40), total: analyticsCount(row as DatabaseRow, "total"), accepted: analyticsCount(row as DatabaseRow, "accepted"), failed: analyticsCount(row as DatabaseRow, "failed") })),
  };
};

export const connectEmailProvider = async (userId: string, providerValue: string, rawCredentials: CredentialRecord) => {
  if (!isProvider(providerValue)) throw new WorkspaceEmailError("Choose a valid email provider.");
  const credentials = normaliseCredentials(providerValue, rawCredentials);
  let providerStatus: { healthy: boolean; validationMode: string; checkedAt: string };
  try {
    providerStatus = await emailProviderAdapter(providerValue).connectCredentials(credentials);
  } catch (error) {
    throw providerUserError(error, "Your email provider credentials are invalid. Please reconnect.");
  }
  const sql = database();
  const encrypted = encryptCredentials(credentials);
  // Connecting credentials only creates a connection. The workspace owner
  // explicitly chooses which connected provider is active.
  const initialRole = "none";
  const result = await sql.query(
    `INSERT INTO email_provider_connections (user_id, provider, mode, credentials_encrypted, credential_hint, validation_mode, access_mode, role, is_active, status, health_ok, last_health_check_at, last_verified_at, last_error, last_error_detail, updated_at)
     VALUES ($1, $2, 'custom', $3, $4, $5, $6, $7, FALSE, 'connected', TRUE, NOW(), NOW(), '', '', NOW())
     ON CONFLICT (user_id, provider) DO UPDATE SET mode = 'custom', credentials_encrypted = EXCLUDED.credentials_encrypted, credential_hint = EXCLUDED.credential_hint, validation_mode = EXCLUDED.validation_mode, access_mode = EXCLUDED.access_mode, role = EXCLUDED.role, is_active = FALSE, status = 'connected', health_ok = TRUE, last_health_check_at = NOW(), last_verified_at = NOW(), last_error = '', last_error_detail = '', updated_at = NOW()
     RETURNING id, provider, mode, credential_hint, validation_mode, access_mode, role, is_active, status, health_ok, last_health_check_at, last_verified_at, last_error, created_at`,
    [userId, providerValue, encrypted, providerHint(providerValue, credentials), providerStatus.validationMode, credentials.access_mode === "send_receive" ? "send_receive" : "send", initialRole],
  );
  await sql.query(
    `UPDATE email_settings
     SET active_provider = '', active_provider_mode = 'custom', updated_at = NOW()
     WHERE user_id = $1 AND active_provider = $2 AND active_provider_mode = 'custom'`,
    [userId, providerValue],
  );
  await auditProviderChange(sql, userId, providerValue, "custom", "connected");
  return safeConnection(result[0] as DatabaseRow);
};

export const connectManagedEmailProvider = async (userId: string) => {
  await ensureEmailWorkspace(userId);
  await verifyManagedSendingConfiguration();
  const sql = database();
  await sql.query(
    `UPDATE email_settings
     SET managed_sending_enabled = TRUE, updated_at = NOW()
     WHERE user_id = $1`,
    [userId],
  );
  await auditProviderChange(sql, userId, "resend", "managed", "connected");
};

export const disconnectManagedEmailProvider = async (userId: string) => {
  await ensureEmailWorkspace(userId);
  const sql = database();
  await sql.query(
    `UPDATE email_settings
     SET managed_sending_enabled = FALSE,
         active_provider = CASE
           WHEN active_provider = 'resend' AND active_provider_mode = 'managed' THEN ''
           ELSE active_provider
         END,
         active_provider_mode = CASE
           WHEN active_provider = 'resend' AND active_provider_mode = 'managed' THEN 'custom'
           ELSE active_provider_mode
         END,
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId],
  );
  await auditProviderChange(sql, userId, "resend", "managed", "disconnected");
};

export const setEmailProviderRole = async (userId: string, providerValue: string, role: string, requestedMode = "custom") => {
  const resolvedRole = role === "active" ? "primary" : role;
  if (!isProvider(providerValue) || !["primary", "fallback", "none"].includes(resolvedRole)) throw new WorkspaceEmailError("Choose a valid provider state.");
  await ensureEmailWorkspace(userId);
  const sql = database();
  const mode: EmailProviderMode = requestedMode === "managed" ? "managed" : "custom";
  if (mode === "managed") {
    if (providerValue !== "resend" || resolvedRole === "fallback") throw new WorkspaceEmailError("Choose a valid managed email provider.");
    if (resolvedRole === "none") {
      await sql.query(`UPDATE email_settings SET active_provider = '', active_provider_mode = 'custom', updated_at = NOW() WHERE user_id = $1 AND active_provider = 'resend' AND active_provider_mode = 'managed'`, [userId]);
      await auditProviderChange(sql, userId, "resend", "managed", "deactivated");
      return;
    }
    const settings = await sql.query(`SELECT managed_sending_enabled FROM email_settings WHERE user_id = $1 LIMIT 1`, [userId]);
    if ((settings[0] as DatabaseRow | undefined)?.managed_sending_enabled !== true) {
      throw new WorkspaceEmailError("Connect MaxForm Managed Sending before setting it as the active provider.", 409, "managed_sender_not_connected");
    }
    await verifyManagedSendingConfiguration();
    await sql.query(`UPDATE email_provider_connections SET role = 'none', is_active = FALSE, updated_at = NOW() WHERE user_id = $1`, [userId]);
    await sql.query(`UPDATE email_settings SET active_provider = 'resend', active_provider_mode = 'managed', updated_at = NOW() WHERE user_id = $1`, [userId]);
    await sql.query(`UPDATE email_identities SET sending_mode = 'managed', domain_verified = FALSE, domain_verification_status = 'not_required', updated_at = NOW() WHERE user_id = $1`, [userId]);
    await auditProviderChange(sql, userId, "resend", "managed", "activated");
    return;
  }
  if (resolvedRole === "fallback") {
    const target = await sql.query(
      `SELECT id, role, is_active
       FROM email_provider_connections
       WHERE user_id = $1 AND provider = $2 AND status = 'connected'
       LIMIT 1`,
      [userId, providerValue],
    );
    if (!target[0]) throw new WorkspaceEmailError("Connect this provider before assigning it as a fallback.", 409);
    if (String((target[0] as DatabaseRow).role || "") === "primary" || (target[0] as DatabaseRow).is_active === true) {
      throw new WorkspaceEmailError("A primary provider cannot also be its own fallback.", 409, "invalid_provider_fallback");
    }
    await sql.query(
      `UPDATE email_provider_connections
       SET role = CASE WHEN provider = $2 THEN 'fallback' ELSE 'none' END,
           is_active = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND (provider = $2 OR role = 'fallback')`,
      [userId, providerValue],
    );
    await sql.query(
      `UPDATE email_settings
       SET fallback_enabled = TRUE, fallback_provider = $1, updated_at = NOW()
       WHERE user_id = $2`,
      [providerValue, userId],
    );
    await auditProviderChange(sql, userId, providerValue, "custom", "activated", { role: "fallback" });
    return;
  }
  if (resolvedRole === "primary") {
    const target = await sql.query(`SELECT id FROM email_provider_connections WHERE user_id = $1 AND provider = $2 AND status = 'connected' LIMIT 1`, [userId, providerValue]);
    if (!target[0]) throw new WorkspaceEmailError("Connect this provider before assigning its role.", 409);
    const updated = await sql.query(
      `UPDATE email_provider_connections
       SET role = CASE WHEN provider = $2 THEN 'primary' ELSE 'none' END,
           is_active = CASE WHEN provider = $2 THEN TRUE ELSE FALSE END,
           updated_at = NOW()
       WHERE user_id = $1
         AND (provider = $2 OR role = 'primary' OR is_active = TRUE)
         AND (provider <> $2 OR status = 'connected')
       RETURNING id`,
      [userId, providerValue],
    );
    if (!updated.some((row) => String((row as DatabaseRow).id || "") === String((target[0] as DatabaseRow).id || ""))) throw new WorkspaceEmailError("This provider is no longer connected. Refresh and try again.", 409);
    await sql.query(`UPDATE email_settings SET active_provider = $1, active_provider_mode = 'custom', fallback_enabled = CASE WHEN fallback_provider = $1 THEN FALSE ELSE fallback_enabled END, fallback_provider = CASE WHEN fallback_provider = $1 THEN '' ELSE fallback_provider END, updated_at = NOW() WHERE user_id = $2`, [providerValue, userId]);
    await sql.query(
      `UPDATE email_identities
       SET sending_mode = 'custom',
           domain_verified = FALSE,
           domain_verification_status = 'pending',
           spf_verified = FALSE,
           dkim_verified = FALSE,
           dmarc_verified = FALSE,
           status = 'pending',
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId],
    );
    await auditProviderChange(sql, userId, providerValue, "custom", "activated");
    return;
  }
  await sql.query(`UPDATE email_provider_connections SET role = 'none', is_active = FALSE, updated_at = NOW() WHERE user_id = $1 AND provider = $2 AND status <> 'disconnected'`, [userId, providerValue]);
  await sql.query(
    `UPDATE email_settings
     SET fallback_enabled = CASE WHEN fallback_provider = $2 THEN FALSE ELSE fallback_enabled END,
         fallback_provider = CASE WHEN fallback_provider = $2 THEN '' ELSE fallback_provider END,
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId, providerValue],
  );
  await auditProviderChange(sql, userId, providerValue, "custom", "deactivated");
};

export const disconnectEmailProvider = async (userId: string, providerValue: string) => {
  if (!isProvider(providerValue)) throw new WorkspaceEmailError("Choose a valid email provider.");
  const sql = database();
  await ensureEmailWorkspace(userId);
  const result = await sql.query(`UPDATE email_provider_connections SET status = 'disconnected', role = 'none', is_active = FALSE, health_ok = FALSE, updated_at = NOW() WHERE user_id = $1 AND provider = $2 RETURNING id`, [userId, providerValue]);
  if (!result[0]) throw new WorkspaceEmailError("This provider connection was not found.", 404);
  await sql.query(`UPDATE email_settings SET active_provider = CASE WHEN active_provider = $2 AND active_provider_mode = 'custom' THEN '' ELSE active_provider END, updated_at = NOW() WHERE user_id = $1`, [userId, providerValue]);
  await auditProviderChange(sql, userId, providerValue, "custom", "disconnected");
};

export const checkEmailProviderHealth = async (userId: string, providerValue: string) => {
  if (!isProvider(providerValue)) throw new WorkspaceEmailError("Choose a valid email provider.");
  const sql = database();
  const rows = await sql.query(`SELECT * FROM email_provider_connections WHERE user_id = $1 AND provider = $2 AND status <> 'disconnected' LIMIT 1`, [userId, providerValue]);
  if (!rows[0]) throw new WorkspaceEmailError("This provider connection was not found.", 404);
  let ok = true;
  let error = "";
  let detail = "";
  let validationMode = cleanText((rows[0] as DatabaseRow).validation_mode, 20) || "delivery";
  try {
    const status = await emailProviderAdapter(providerValue).getProviderStatus(decryptCredentials(String((rows[0] as DatabaseRow).credentials_encrypted || "")));
    validationMode = status.validationMode;
  } catch (caught) {
    ok = false;
    const safe = providerUserError(caught, "Your email provider credentials are invalid. Please reconnect.");
    error = safe.message;
    detail = safe.detail;
  }
  await sql.query(`UPDATE email_provider_connections SET health_ok = $1, status = $2, validation_mode = $3, last_health_check_at = NOW(), last_verified_at = CASE WHEN $1 THEN NOW() ELSE last_verified_at END, last_error = $4, last_error_detail = $5, updated_at = NOW() WHERE user_id = $6 AND provider = $7`, [ok, ok ? "connected" : "attention", validationMode, error, detail, userId, providerValue]);
  return { ok, checkedAt: new Date().toISOString(), error };
};

const domainOperationError = (error: unknown, fallback: string) => {
  if (error instanceof WorkspaceEmailError) return error;
  if (error instanceof EmailAdapterError && (error.status === 401 || error.status === 403 || error.code === "provider_credentials_invalid")) {
    return new WorkspaceEmailError("Your provider key needs domain-management permission to configure a custom domain. Send-only keys still work with MaxForm Managed Sending.", 422, "domain_management_required", false, error.detail);
  }
  return providerUserError(error, fallback);
};

const activeProviderConnection = async (userId: string) => {
  const rows = await database().query(
    `SELECT * FROM email_provider_connections
     WHERE user_id = $1 AND role = 'primary' AND status = 'connected' AND health_ok = TRUE
     LIMIT 1`,
    [userId],
  );
  const connection = rows[0] as DatabaseRow | undefined;
  if (!connection) throw new WorkspaceEmailError("Connect an email provider before configuring a custom domain.", 409, "provider_required");
  return connection;
};

const domainPayload = (domain: ProviderSendingDomain) => JSON.stringify(domain.records || []);

const saveSendingDomainRecord = async (
  userId: string,
  connection: DatabaseRow,
  domain: ProviderSendingDomain,
  status: ProviderSendingDomain["status"] = domain.status,
  error = "",
  detail = "",
) => {
  const sql = database();
  const connectionId = String(connection.provider_connection_id || connection.connection_id || connection.id);
  const existing = await sql.query(
    `SELECT id, dns_records FROM email_sending_domains
     WHERE user_id = $1 AND provider_connection_id = $2 AND LOWER(domain) = LOWER($3)
     LIMIT 1`,
    [userId, connectionId, domain.domain],
  );
  const existingRecords = Array.isArray((existing[0] as DatabaseRow | undefined)?.dns_records)
    ? (existing[0] as DatabaseRow).dns_records as ProviderSendingDomain["records"]
    : [];
  const verified = status === "verified";
  const values = [
    userId,
    connectionId,
    String(connection.provider),
    domain.domain.toLowerCase(),
    domain.id,
    status,
    domainPayload(domain.records?.length ? domain : { ...domain, records: existingRecords }),
    error,
    detail,
  ];
  const rows = existing[0]
    ? await sql.query(
        `UPDATE email_sending_domains
         SET provider = $3, provider_domain_id = $5, status = $6,
             dns_records = $7::jsonb, last_error = $8,
             last_error_detail = $9, last_checked_at = NOW(),
             verified_at = CASE WHEN $6 = 'verified' THEN COALESCE(verified_at, NOW()) ELSE verified_at END,
             updated_at = NOW()
         WHERE id = $10 AND user_id = $1 AND provider_connection_id = $2
           AND LOWER(domain) = LOWER($4)
         RETURNING *`,
        [...values, String((existing[0] as DatabaseRow).id)],
      )
    : await sql.query(
        `INSERT INTO email_sending_domains
         (user_id, provider_connection_id, provider, domain, provider_domain_id,
          status, dns_records, last_error, last_error_detail, last_checked_at, verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, NOW(), CASE WHEN $6 = 'verified' THEN NOW() ELSE NULL END)
         RETURNING *`,
        values,
      );
  return safeSendingDomain(rows[0] as DatabaseRow);
};

export const addEmailSendingDomain = async (userId: string, rawDomain: string) => {
  const domain = cleanText(rawDomain, 255).toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!validDomain(domain)) throw new WorkspaceEmailError("Enter a valid custom domain.", 400, "invalid_domain");
  const connection = await activeProviderConnection(userId);
  const provider = cleanText(connection.provider, 32) as EmailProviderId;
  const adapter = emailProviderAdapter(provider);
  try {
    const credentials = decryptCredentials(String(connection.credentials_encrypted || ""));
    // Import an existing provider-side domain when the user already verified it
    // in the provider dashboard. This keeps the in-app identity flow usable
    // without creating a duplicate domain at the provider.
    const existing = (await adapter.getSendingDomains(credentials)).find((item) => item.domain === domain);
    if (existing) return saveSendingDomainRecord(userId, connection, existing, existing.status);
    if (!adapter.addDomain) throw new WorkspaceEmailError("Custom domain management is not available through this provider connection. Verify the domain with the provider, then check it here.", 422, "domain_management_unsupported");
    const created = await adapter.addDomain(credentials, domain);
    return saveSendingDomainRecord(userId, connection, created, created.status);
  } catch (error) {
    throw domainOperationError(error, "The custom domain could not be added. Please try again.");
  }
};

export const verifyEmailSendingDomain = async (userId: string, domainId: string) => {
  if (!isUuid(domainId)) throw new WorkspaceEmailError("Choose a valid sending domain.", 400, "invalid_domain");
  const sql = database();
  const rows = await sql.query(
    `SELECT domain_record.*, connection.credentials_encrypted, connection.provider,
            connection.status AS connection_status
     FROM email_sending_domains domain_record
     JOIN email_provider_connections connection ON connection.id = domain_record.provider_connection_id
     WHERE domain_record.id = $1 AND domain_record.user_id = $2
     LIMIT 1`,
    [domainId, userId],
  );
  const row = rows[0] as DatabaseRow | undefined;
  if (!row) throw new WorkspaceEmailError("This sending domain was not found.", 404, "domain_not_found");
  if (String(row.connection_status) !== "connected") throw new WorkspaceEmailError("Reconnect the provider before checking this domain.", 409, "provider_required");
  const provider = cleanText(row.provider, 32) as EmailProviderId;
  try {
    const credentials = decryptCredentials(String(row.credentials_encrypted || ""));
    const adapter = emailProviderAdapter(provider);
    const checked = await adapter.verifyDomain(credentials, cleanText(row.domain, 255));
    const records = checked.records.length
      ? checked.records
      : (Array.isArray(row.dns_records) ? row.dns_records as ProviderSendingDomain["records"] : []);
    const status = checked.status === "unknown" ? "pending" : checked.status;
    return saveSendingDomainRecord(userId, row, { ...checked, records, status }, status);
  } catch (error) {
    const safe = domainOperationError(error, "The custom domain could not be verified. Please try again.");
    const failed = {
      id: cleanText(row.provider_domain_id || row.domain, 160),
      domain: cleanText(row.domain, 255),
      status: "failed" as const,
      records: Array.isArray(row.dns_records) ? row.dns_records : [],
    };
    await saveSendingDomainRecord(userId, row, failed, "failed", safe.message, safe.detail);
    throw safe;
  }
};

export const deleteEmailSendingDomain = async (userId: string, domainId: string) => {
  if (!isUuid(domainId)) throw new WorkspaceEmailError("Choose a valid sending domain.", 400, "invalid_domain");
  const sql = database();
  const rows = await sql.query(
    `SELECT id, domain
     FROM email_sending_domains
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [domainId, userId],
  );
  const domain = rows[0] as DatabaseRow | undefined;
  if (!domain) throw new WorkspaceEmailError("This sending domain was not found.", 404, "domain_not_found");

  // Removing the verification record must not leave a custom identity looking
  // ready to send. Keep both changes atomic; the sender remains editable and
  // can be re-verified later.
  await sql.transaction((transaction) => [
    transaction`DELETE FROM email_sending_domains WHERE id = ${domainId} AND user_id = ${userId}`,
    transaction`
      UPDATE email_identities
      SET domain_verified = FALSE,
          domain_verification_status = 'pending',
          spf_verified = FALSE,
          dkim_verified = FALSE,
          dmarc_verified = FALSE,
          status = 'pending',
          updated_at = NOW()
      WHERE user_id = ${userId}
        AND sending_mode = 'custom'
        AND LOWER(COALESCE(NULLIF(custom_domain, ''), domain)) = LOWER(${cleanText(domain.domain, 255)})
    `,
  ]);
  return { deleted: true, domain: cleanText(domain.domain, 255) };
};

const inboundTokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export const createEmailInboundWebhook = async (userId: string, providerValue: string) => {
  if (!isProvider(providerValue)) throw new WorkspaceEmailError("Choose a valid email provider.");
  const sql = database();
  const rows = await sql.query(`SELECT id FROM email_provider_connections WHERE user_id = $1 AND provider = $2 AND status = 'connected' LIMIT 1`, [userId, providerValue]);
  const connectionId = cleanText((rows[0] as DatabaseRow | undefined)?.id, 64);
  if (!connectionId) throw new WorkspaceEmailError("Connect this provider before creating its inbound webhook.", 409);
  const token = randomBytes(32).toString("base64url");
  await sql.query(`UPDATE email_provider_connections SET inbound_token_hash = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`, [inboundTokenHash(token), connectionId, userId]);
  return { connectionId, token, path: `/api/email/inbound?connection=${encodeURIComponent(connectionId)}&token=${encodeURIComponent(token)}` };
};

export const createEmailAnalyticsWebhook = async (userId: string, providerValue: string) => {
  if (!isProvider(providerValue) || providerValue === "smtp") throw new WorkspaceEmailError("Choose a webhook-capable email provider.");
  if (providerValue === "tosend") throw new WorkspaceEmailError("ToSend uses the deployment webhook at /api/webhooks/email/tosend for bounces and complaints. Configure its signing secret on the server.", 422, "tosend_webhook_configuration");
  const sql = database();
  const rows = await sql.query(`SELECT id FROM email_provider_connections WHERE user_id = $1 AND provider = $2 AND status = 'connected' LIMIT 1`, [userId, providerValue]);
  const connectionId = cleanText((rows[0] as DatabaseRow | undefined)?.id, 64);
  if (!connectionId) throw new WorkspaceEmailError("Connect this provider before creating its analytics webhook.", 409);
  const token = randomBytes(32).toString("base64url");
  await sql.query(`UPDATE email_provider_connections SET event_token_hash = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`, [inboundTokenHash(token), connectionId, userId]);
  return { connectionId, token, path: `/api/email/events?connection=${encodeURIComponent(connectionId)}&token=${encodeURIComponent(token)}` };
};

type InboundEmailInput = {
  connectionId: string;
  token: string;
  providerMessageId?: string;
  sender: string;
  recipient: string;
  subject: string;
  html?: string;
  text?: string;
};

export const receiveWorkspaceEmail = async (input: InboundEmailInput) => {
  if (!isUuid(input.connectionId) || !input.token || input.token.length < 32) {
    throw new WorkspaceEmailError("The inbound email endpoint is not authorized.", 401, "inbound_unauthorized");
  }
  const sql = database();
  const rows = await sql.query(`SELECT id, user_id, provider, inbound_token_hash FROM email_provider_connections WHERE id = $1 AND status = 'connected' LIMIT 1`, [input.connectionId]);
  const connection = rows[0] as DatabaseRow | undefined;
  const storedHash = cleanText(connection?.inbound_token_hash, 128);
  const receivedHash = inboundTokenHash(input.token);
  const validToken = storedHash.length === receivedHash.length && timingSafeEqual(Buffer.from(storedHash), Buffer.from(receivedHash));
  if (!connection || !validToken) throw new WorkspaceEmailError("The inbound email endpoint is not authorized.", 401, "inbound_unauthorized");
  const sender = senderEmail(cleanText(input.sender, 320)).toLowerCase();
  const recipient = senderEmail(cleanText(input.recipient, 320)).toLowerCase();
  const subject = cleanText(input.subject, 500);
  const html = String(input.html || "").slice(0, 250_000);
  const text = String(input.text || "").slice(0, 250_000) || plainText(html);
  if (!validEmail(sender) || !validEmail(recipient) || (!html && !text)) throw new WorkspaceEmailError("The inbound message is incomplete.", 400, "invalid_inbound_message");
  const providerMessageId = cleanText(input.providerMessageId, 255);
  const result = await sql.query(
    `INSERT INTO email_inbound_messages (user_id, provider_connection_id, provider, provider_message_id, sender, recipient, subject, html_body, text_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, provider, provider_message_id) WHERE provider_message_id <> '' DO NOTHING
     RETURNING id`,
    [String(connection.user_id), input.connectionId, cleanText(connection.provider, 32), providerMessageId, sender, recipient, subject, html, text],
  );
  return { accepted: true, duplicate: !result[0] };
};

type EmailDeliveryEventInput = {
  connectionId: string;
  token: string;
  providerMessageId: string;
  providerEventId?: string;
  status: "delivered" | "opened" | "clicked" | "bounced" | "complained";
  destination?: string;
};

export const receiveWorkspaceEmailDeliveryEvent = async (input: EmailDeliveryEventInput) => {
  if (!isUuid(input.connectionId) || !input.token || input.token.length < 32 || !input.providerMessageId) throw new WorkspaceEmailError("The email analytics endpoint is not authorized.", 401, "analytics_unauthorized");
  const sql = database();
  const rows = await sql.query(`SELECT id, user_id, provider, event_token_hash FROM email_provider_connections WHERE id = $1 AND status = 'connected' LIMIT 1`, [input.connectionId]);
  const connection = rows[0] as DatabaseRow | undefined;
  const storedHash = cleanText(connection?.event_token_hash, 128);
  const receivedHash = inboundTokenHash(input.token);
  const validToken = storedHash.length === receivedHash.length && timingSafeEqual(Buffer.from(storedHash), Buffer.from(receivedHash));
  if (!connection || !validToken) throw new WorkspaceEmailError("The email analytics endpoint is not authorized.", 401, "analytics_unauthorized");
  const providerMessageId = cleanText(input.providerMessageId, 255).replace(/^<|>$/g, "");
  const workspaceId = String(connection.user_id);
  const provider = cleanText(connection.provider, 32);
  const destination = cleanText(input.destination, 2_048);
  // Persist the normalized event before dispatching it. This is the durable
  // outbox for provider retries: a 202 response never depends on a web
  // process-local promise surviving a restart.
  const providerEventId = (
    cleanText(input.providerEventId, 255) ||
    `${provider}:${providerMessageId}:${input.status}:${destination}`
  ).slice(0, 255);
  const webhookRows = await sql.query(
    `INSERT INTO campaign_webhook_events (
       workspace_id, provider, provider_event_id, provider_message_id,
       event_type, destination, payload
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (workspace_id, provider, provider_event_id) DO UPDATE SET
       updated_at = NOW()
     RETURNING id`,
    [
      workspaceId,
      provider,
      providerEventId,
      providerMessageId,
      input.status,
      destination,
      JSON.stringify({ providerMessageId, providerEventId, status: input.status, destination }),
    ],
  );
  const webhookEventId = cleanText((webhookRows[0] as DatabaseRow | undefined)?.id, 64);
  const result = await sql.query(`UPDATE email_logs
    SET status = CASE
      WHEN status IN ('bounced', 'complained') THEN status
      WHEN $1 = 'delivered' AND status IN ('opened', 'clicked') THEN status
      WHEN $1 = 'opened' AND status = 'clicked' THEN status
      ELSE $1
    END,
      provider_response = jsonb_set(COALESCE(provider_response, '{}'::jsonb), '{delivery_event}', jsonb_build_object('status', $1, 'receivedAt', NOW()), TRUE),
      updated_at = NOW()
    WHERE user_id = $2
      AND provider = $3
      AND trim(BOTH '<>' FROM provider_message_id) = trim(BOTH '<>' FROM $4)
    RETURNING id`, [input.status, workspaceId, provider, providerMessageId]);
  const campaign = await recordCampaignMessageEvent({
    providerMessageId,
    providerEventId,
    status: input.status,
    userId: workspaceId,
    provider,
    source: "provider",
    destination,
  });
  let queued = false;
  try {
    const queuedResult = await enqueueCampaignWebhookJob({
      webhookEventId,
      workspaceId,
      provider,
      providerMessageId,
      providerEventId,
      status: input.status,
      destination,
    });
    queued = queuedResult.enqueued;
  } catch (error) {
    console.error("[email-events] webhook queue enqueue failed", {
      type: error instanceof Error ? error.name : typeof error,
    });
    const required = process.env.QUEUE_REQUIRED === "true" || process.env.NODE_ENV === "production";
    if (required) {
      throw new WorkspaceEmailError(
        "The event was stored but could not be queued for processing. Please retry the webhook.",
        503,
        "analytics_queue_unavailable",
        true,
      );
    }
  }
  if (!queued) {
    await sql.query(
      `UPDATE campaign_webhook_events
       SET processed_at = NOW(), attempts = attempts + 1,
           processing_error = '', updated_at = NOW()
       WHERE id = $1::uuid AND processed_at IS NULL`,
      [webhookEventId],
    );
  }
  return {
    accepted: true,
    matched: Boolean(result[0]),
    campaignMatched: campaign.matched,
    queued,
  };
};

/**
 * Returns the provider's live account limit when the adapter exposes one.
 * Adapters without an account endpoint intentionally return null so the
 * database's conservative provider_rate_limits row remains authoritative.
 */
export const getWorkspaceEmailProviderLimits = async (
  userId: string,
): Promise<(ProviderSendingLimits & { provider: EmailProviderId }) | null> => {
  const active = await activeDelivery(database(), userId);
  if (!active) return null;
  const adapter = emailProviderAdapter(active.provider);
  if (!adapter.getSendingLimits) return null;
  const credentials = active.mode === "managed"
    ? managedResendCredentials()
    : active.connection
      ? decryptCredentials(String(active.connection.credentials_encrypted || ""))
      : {};
  try {
    return { provider: active.provider, ...(await adapter.getSendingLimits(credentials)) };
  } catch (error) {
    // A failed health lookup must not make an existing send request crash. The
    // dispatch path records the provider error when it actually attempts work.
    console.error("[email-provider] account limit lookup failed", {
      provider: active.provider,
      type: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
};

/**
 * Applies a persisted ToSend bounce or complaint exactly once. The webhook
 * receiver stores the provider payload first; this worker is the only place
 * that mutates delivery state and the workspace suppression list.
 */
export const processToSendWebhookEvent = async (webhookEventId: string) => {
  if (!isUuid(webhookEventId)) throw new WorkspaceEmailError("The email webhook payload is invalid.", 400, "invalid_webhook_payload");
  const sql = database();
  const rows = (await sql.query(
    `SELECT id, provider_event_id, provider_message_id, event_type,
            recipient, payload, processed_at
     FROM email_provider_webhook_events
     WHERE id = $1::uuid
     LIMIT 1`,
    [webhookEventId],
  )) as DatabaseRow[];
  const eventRow = rows[0];
  if (!eventRow) throw new WorkspaceEmailError("This email webhook event was not found.", 404, "webhook_not_found");
  if (eventRow.processed_at) return { processed: true, duplicate: true, matched: true };
  await sql.query(
    `UPDATE email_provider_webhook_events
     SET attempts = attempts + 1, processing_error = '', updated_at = NOW()
     WHERE id = $1::uuid AND processed_at IS NULL`,
    [webhookEventId],
  );

  let event: ReturnType<typeof parseToSendWebhook>;
  try {
    event = parseToSendWebhook(JSON.stringify(eventRow.payload || {}));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid ToSend webhook payload.";
    await sql.query(
      `UPDATE email_provider_webhook_events SET processing_error = $2, updated_at = NOW() WHERE id = $1::uuid`,
      [webhookEventId, message.slice(0, 1_000)],
    );
    throw new WorkspaceEmailError(message, 422, "invalid_webhook_payload");
  }
  const messageId = cleanText(event.providerMessageId, 255);
  const logRows = (await sql.query(
    `SELECT id, user_id, recipient, provider, provider_message_id, status
     FROM email_logs
     WHERE provider = 'tosend'
       AND trim(BOTH '<>' FROM provider_message_id) = trim(BOTH '<>' FROM $1)
     ORDER BY created_at DESC
     LIMIT 1`,
    [messageId],
  )) as DatabaseRow[];
  const log = logRows[0];
  if (!log) {
    const message = "The ToSend event arrived before its delivery log was available.";
    await sql.query(
      `UPDATE email_provider_webhook_events SET processing_error = $2, updated_at = NOW() WHERE id = $1::uuid`,
      [webhookEventId, message],
    );
    throw new WorkspaceEmailError(message, 503, "provider_event_unmatched", true);
  }

  const isComplaint = event.eventType === "complaint";
  const status = isComplaint ? "complained" : "bounced";
  const eventPayload = {
    provider: "tosend",
    eventType: event.eventType,
    providerEventId: event.providerEventId,
    providerMessageId: messageId,
    recipient: event.recipient,
    hardBounce: event.hardBounce,
    reason: event.reason,
    occurredAt: event.occurredAt,
  };
  await sql.query(
    `UPDATE email_logs
     SET status = CASE
           WHEN status = 'complained' THEN status
           WHEN $2 = 'complained' THEN 'complained'
           ELSE 'bounced'
         END,
         provider_response = jsonb_set(
           COALESCE(provider_response, '{}'::jsonb),
           '{tosend_event}', $3::jsonb, TRUE
         ),
         last_error = $4,
         provider_error_detail = CASE WHEN $5 THEN 'hard_bounce' ELSE 'soft_bounce' END,
         uncertain_at = NULL,
         updated_at = NOW()
     WHERE id = $1::uuid`,
    [String(log.id), status, JSON.stringify(eventPayload), event.reason, event.hardBounce],
  );

  // Complaints and permanent bounces are global workspace suppression signals.
  // Soft bounces remain visible and reportable but do not permanently suppress
  // a recipient who may be temporarily unavailable.
  if (isComplaint || event.hardBounce) {
    await sql.query(
      `INSERT INTO email_suppressions (
         user_id, recipient, reason, reason_detail, source_message_id
       ) VALUES ($1::uuid, $2, $3, $4, $5::uuid)
       ON CONFLICT (user_id, LOWER(recipient)) DO UPDATE
         SET reason = EXCLUDED.reason,
             reason_detail = CASE WHEN EXCLUDED.reason_detail <> '' THEN EXCLUDED.reason_detail ELSE email_suppressions.reason_detail END,
             source_message_id = COALESCE(EXCLUDED.source_message_id, email_suppressions.source_message_id)`,
      [String(log.user_id), event.recipient, isComplaint ? "complaint" : "bounce", event.reason, String(log.id)],
    );
  }

  const campaignRows = (await sql.query(
    `UPDATE contact_campaign_messages message
     SET status = CASE
           WHEN $2 = 'complaint' THEN 'complained'
           WHEN $3 THEN 'hard_bounce'
           ELSE 'soft_bounce'
         END,
         provider = 'tosend',
         bounced_at = CASE WHEN $2 = 'bounce' THEN COALESCE(bounced_at, NOW()) ELSE bounced_at END,
         complaint_at = CASE WHEN $2 = 'complaint' THEN COALESCE(complaint_at, NOW()) ELSE complaint_at END,
         failure_kind = CASE WHEN $2 = 'complaint' THEN 'complaint' WHEN $3 THEN 'hard_bounce' ELSE 'temporary' END,
         failure_reason = $4,
         last_provider_event_id = $5,
         processing_started_at = NULL,
         updated_at = NOW()
     FROM contact_campaigns campaign
     WHERE message.campaign_id = campaign.id
       AND campaign.user_id = $1::uuid
       AND trim(BOTH '<>' FROM message.provider_message_id) = trim(BOTH '<>' FROM $6)
     RETURNING message.id, message.campaign_id`,
    [String(log.user_id), isComplaint ? "complaint" : "bounce", event.hardBounce, event.reason, event.providerEventId, messageId],
  )) as DatabaseRow[];
  if (campaignRows[0]) {
    await recordCampaignMessageEvent({
      providerMessageId: messageId,
      providerEventId: event.providerEventId,
      status: isComplaint ? "complained" : "bounced",
      userId: String(log.user_id),
      provider: "tosend",
      source: "provider",
      metadata: { reason: event.reason, hardBounce: event.hardBounce, occurredAt: event.occurredAt },
      destination: event.recipient,
    });
  }
  await sql.query(
    `UPDATE email_provider_webhook_events
     SET processed_at = NOW(), processing_error = '', updated_at = NOW()
     WHERE id = $1::uuid AND processed_at IS NULL`,
    [webhookEventId],
  );
  return { processed: true, duplicate: false, matched: true, campaignMatched: Boolean(campaignRows[0]), status };
};

export const saveEmailIdentity = async (userId: string, input: Record<string, unknown>) => {
  const id = cleanText(input.id, 64);
  const requestedSenderName = cleanText(input.senderName, 160);
  const legacySenderEmail = cleanText(input.senderEmail, 320).toLowerCase();
  const requestedReplyTo = cleanText(input.replyTo, 320).toLowerCase();
  const selector = "default";
  const sql = database();
  const active = await activeDelivery(sql, userId);
  const requestedMode: EmailProviderMode = active?.mode || (input.sendingMode === "custom" ? "custom" : "managed");
  const workspaceRows = await sql.query(
    `SELECT COALESCE(company.company_name, user_account.full_name, '') AS workspace_name
     FROM users user_account
     LEFT JOIN company_settings company ON company.user_id = user_account.id
     WHERE user_account.id = $1 LIMIT 1`,
    [userId],
  );
  const workspaceName = cleanText((workspaceRows[0] as DatabaseRow | undefined)?.workspace_name, 160) || "MaxForm workspace";
  const senderName = requestedSenderName || workspaceName;
  const existingRows = id
    ? await sql.query(`SELECT * FROM email_identities WHERE id = $1 AND user_id = $2 LIMIT 1`, [id, userId])
    : [];
  const existing = existingRows[0] as DatabaseRow | undefined;
  const replyTo = requestedReplyTo || (validEmail(legacySenderEmail) ? legacySenderEmail : cleanText(existing?.reply_to, 320).toLowerCase());
  if (!senderName || !validEmail(replyTo)) throw new WorkspaceEmailError("Enter a valid sender name and reply-to address.");
  if (!id) {
    const existing = await sql.query(`SELECT id FROM email_identities WHERE user_id = $1 LIMIT 1`, [userId]);
    if (existing[0]) throw new WorkspaceEmailError("This workspace already has a sender identity. Edit or delete it before creating another.", 409, "identity_limit");
  }
  const sendingMode = requestedMode;
  const customSenderEmail = cleanText(input.customSenderEmail || (sendingMode === "custom" ? legacySenderEmail : ""), 320).toLowerCase();
  const customDomain = cleanText(input.customDomain || (sendingMode === "custom" ? existing?.custom_domain || existing?.domain : "") || (customSenderEmail.split("@")[1] || ""), 255).toLowerCase();
  let domainVerified = false;
  let domainStatus = "not_required";
  if (sendingMode === "custom") {
    if (!validEmail(customSenderEmail)) throw new WorkspaceEmailError("Enter a valid custom sender email.", 400, "invalid_sender_identity");
    const senderDomainValue = customSenderEmail.split("@")[1] || "";
    if (!validDomain(customDomain) || senderDomainValue !== customDomain) throw new WorkspaceEmailError("The custom sender email must belong to the selected custom domain.", 400, "invalid_sender_identity");
    if (active?.provider === "smtp") {
      const smtpCredentials = active.connection ? decryptCredentials(String(active.connection.credentials_encrypted || "")) : {};
      const authenticatedMailbox = cleanText(smtpCredentials.username, 320).toLowerCase();
      if (validEmail(authenticatedMailbox) && authenticatedMailbox !== customSenderEmail) {
        throw new WorkspaceEmailError("The SMTP From email must match the authenticated SMTP mailbox.", 422, "invalid_sender_identity");
      }
      domainVerified = true;
      domainStatus = "verified";
    } else if (active?.provider === "sender") {
      // Sender's public API has no documented DNS-domain management route.
      // The account owner verifies the domain in Sender; the transactional
      // API remains the final authority and rejects unverified From domains.
      domainVerified = true;
      domainStatus = "verified";
    } else {
      const verified = await sql.query(
        `SELECT domain_record.id
         FROM email_sending_domains domain_record
         JOIN email_provider_connections connection ON connection.id = domain_record.provider_connection_id
         WHERE domain_record.user_id = $1
           AND LOWER(domain_record.domain) = LOWER($2)
           AND domain_record.status = 'verified'
           AND connection.role = 'primary'
           AND connection.provider = $3
           AND connection.status = 'connected'
         LIMIT 1`,
        [userId, customDomain, active?.provider || ""],
      );
      if (!verified[0]) throw customDomainUnverified(customDomain);
      domainVerified = true;
      domainStatus = "verified";
    }
  }
  const managedDomain = managedSenderDomain();
  if (sendingMode === "managed" && !managedDomain) throw managedSenderUnavailable();
  const requestedPrefix = input.senderPrefix == null
    ? cleanText(existing?.sender_prefix, 63) || normalizeManagedSenderPrefix(workspaceName) || normalizeManagedSenderPrefix(senderName)
    : cleanText(input.senderPrefix, 63);
  const prefixError = sendingMode === "managed" ? managedSenderPrefixError(requestedPrefix) : "";
  if (prefixError) throw new WorkspaceEmailError(prefixError, 400, "invalid_sender_prefix");
  const managedEmail = sendingMode === "managed" ? managedSenderEmail(requestedPrefix, managedDomain) : "";
  const effectiveSenderEmail = sendingMode === "custom" ? customSenderEmail : managedEmail;
  const managedReady = sendingMode === "managed" && validEmail(effectiveSenderEmail);
  if (sendingMode === "managed" && !managedReady && !id) {
    // Saving the identity is still allowed so the workspace can finish setup;
    // sending will remain blocked with a precise managed-sender error.
    domainStatus = "pending";
  }
  const domain = sendingMode === "custom" ? customDomain : managedDomain;
  const rows = id
    ? await sql.query(`UPDATE email_identities
       SET sender_name = $1, sender_email = $2, reply_to = $3, domain = $4,
           dkim_selector = $5, sending_mode = $6, sender_prefix = $7,
           managed_domain = $8, managed_sender_email = $9,
           generated_sender_email = $10, custom_sender_email = $11,
           custom_domain = $12, domain_verified = $13,
           domain_verification_status = $14,
           domain_verification_records = CASE WHEN $6 = 'custom' THEN COALESCE(domain_verification_records, '[]'::jsonb) ELSE '[]'::jsonb END,
           domain_last_checked_at = CASE WHEN $13 THEN domain_last_checked_at ELSE NULL END,
           spf_verified = $13, dkim_verified = $13, dmarc_verified = $13,
           status = CASE WHEN $13 OR ($6 = 'managed' AND $2 <> '') THEN 'verified' ELSE 'pending' END,
           is_default = TRUE, updated_at = NOW()
       WHERE id = $15 AND user_id = $16 RETURNING *`, [senderName, effectiveSenderEmail, replyTo, domain, selector, sendingMode, requestedPrefix, managedDomain, managedEmail, managedEmail, customSenderEmail, customDomain, domainVerified, domainStatus, id, userId])
    : await sql.query(`INSERT INTO email_identities
       (user_id, sender_name, sender_email, reply_to, domain, dkim_selector,
        sending_mode, sender_prefix, managed_domain, managed_sender_email,
        generated_sender_email, custom_sender_email, custom_domain,
        domain_verified, domain_verification_status, domain_verification_records,
        spf_verified, dkim_verified, dmarc_verified, status, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12,
               $13, $14, '[]'::jsonb, $13, $13, $13,
               CASE WHEN $13 OR ($7 = 'managed' AND $3 <> '') THEN 'verified' ELSE 'pending' END,
               TRUE) RETURNING *`, [userId, senderName, effectiveSenderEmail, replyTo, domain, selector, sendingMode, requestedPrefix, managedDomain, managedEmail, customSenderEmail, customDomain, domainVerified, domainStatus]);
  if (!rows[0]) throw new WorkspaceEmailError("This sender identity could not be saved.", 404);
  await ensureEmailWorkspace(userId);
  await sql.query(`UPDATE email_settings SET default_identity_id = $1, updated_at = NOW() WHERE user_id = $2`, [String((rows[0] as DatabaseRow).id), userId]);
  return safeIdentity(rows[0] as DatabaseRow);
};

export const deleteEmailIdentity = async (userId: string, identityId: string) => {
  if (!isUuid(identityId)) throw new WorkspaceEmailError("Choose a valid sender identity.");
  const sql = database();
  const deleted = await sql.query(`DELETE FROM email_identities WHERE id = $1 AND user_id = $2 RETURNING id`, [identityId, userId]);
  if (!deleted[0]) throw new WorkspaceEmailError("This sender identity was not found.", 404);
  await sql.query(`UPDATE email_settings SET default_identity_id = NULL, updated_at = NOW() WHERE user_id = $1`, [userId]);
};

export const saveEmailTemplate = async (userId: string, input: Record<string, unknown>) => {
  await ensureEmailWorkspace(userId);
  const id = cleanText(input.id, 64);
  const key = cleanText(input.key, 100).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const module = cleanText(input.module, 40).toLowerCase();
  const name = cleanText(input.name, 160);
  const subject = cleanText(input.subject, 500);
  const htmlBody = String(input.htmlBody || "").trim().slice(0, 250_000);
  const textBody = String(input.textBody || "").trim().slice(0, 250_000) || plainText(htmlBody);
  const identityId = cleanText(input.identityId, 64) || null;
  const requestedBlocks = Array.isArray(input.blocks) ? input.blocks.slice(0, 12) : [];
  const serializedBlocks = JSON.stringify(requestedBlocks);
  if (key.startsWith("event_override_")) throw new WorkspaceEmailError("Event email templates are shared across the workspace.");
  // Builder uploads are intentionally kept small, but a locally-uploaded image is
  // stored with the visual block so the template remains portable and previewable.
  if (serializedBlocks.length > 220_000) throw new WorkspaceEmailError("This email design is too large. Use an image smaller than 120 KB.");
  const blocks = serializedBlocks;
  if (!key || !module || !name || !subject || !htmlBody) throw new WorkspaceEmailError("Template name, key, module, subject, and message are required.");
  const sql = database();
  if (identityId) {
    const identities = await sql.query(`SELECT id FROM email_identities WHERE id = $1 AND user_id = $2 LIMIT 1`, [identityId, userId]);
    if (!identities[0]) throw new WorkspaceEmailError("Choose a sender identity from this workspace.");
  }
  const rows = id
    ? await sql.query(`UPDATE email_templates SET key = $1, module = $2, name = $3, subject = $4, html_body = $5, text_body = $6, blocks = $7::jsonb, identity_id = $8, is_custom = TRUE, updated_at = NOW() WHERE id = $9 AND user_id = $10 RETURNING *`, [key, module, name, subject, htmlBody, textBody, blocks, identityId, id, userId])
    : await sql.query(`INSERT INTO email_templates (user_id, key, module, name, subject, html_body, text_body, blocks, identity_id, is_custom) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, TRUE) RETURNING *`, [userId, key, module, name, subject, htmlBody, textBody, blocks, identityId]);
  if (!rows[0]) throw new WorkspaceEmailError("This template could not be saved.", 404);
  return safeTemplate(rows[0] as DatabaseRow);
};

export const saveEmailSettings = async (userId: string, input: Record<string, unknown>) => {
  await ensureEmailWorkspace(userId);
  const rate = Math.round(Number(input.rateLimitPerHour));
  const threshold = Number(input.suppressionThreshold);
  const behavior = cleanText(input.suppressionBehavior, 32);
  const identityId = cleanText(input.defaultIdentityId, 64) || null;
  if (!Number.isInteger(rate) || rate < 10 || rate > 100_000 || !Number.isFinite(threshold) || threshold < 0.1 || threshold > 100 || !["suppress", "pause_campaigns"].includes(behavior)) throw new WorkspaceEmailError("Enter valid email safety settings.");
  const sql = database();
  if (identityId) {
    const identities = await sql.query(`SELECT id FROM email_identities WHERE id = $1 AND user_id = $2 LIMIT 1`, [identityId, userId]);
    if (!identities[0]) throw new WorkspaceEmailError("Choose a sender identity from this workspace.");
  }
  await sql.query(`UPDATE email_settings SET default_identity_id = $1, rate_limit_per_hour = $2, suppression_threshold = $3, suppression_behavior = $4, updated_at = NOW() WHERE user_id = $5`, [identityId, rate, threshold, behavior, userId]);
};

export type WorkspaceEmailInput = {
  userId: string;
  templateKey?: string;
  to: string;
  variables?: Record<string, unknown>;
  identityId?: string | null;
  sourceEventId?: string | null;
  /** Internal ticket-instance IDs represented by this delivery. Never public tokens. */
  relatedTicketIds?: string[];
  idempotencyKey?: string | null;
  /** Keep the message queued until this instant. */
  scheduledFor?: string | Date | null;
  /** Headers such as List-Unsubscribe retained through queued delivery. */
  headers?: Record<string, string>;
  /** Explicit compliance/routing classification. */
  emailClassification?: "TRANSACTIONAL" | "MARKETING" | "SYSTEM" | "EVENT" | "APPOINTMENT" | "DOCUMENT" | "FORM_NOTIFICATION" | "CAMPAIGN" | "AUTHENTICATION";
  /**
   * Internal dispatch control. Campaign waves explicitly deliver their
   * messages and must not also start the normal microtask delivery path.
   */
  autoDeliver?: boolean;
  override?: { module?: string; subject: string; html: string; text?: string; replyTo?: string };
};

/**
 * Campaign waves have their own durable, provider-aware throughput controls in
 * campaign-dispatch.ts. They are staged one message at a time before the wave
 * is delivered, so counting those queued rows against the generic workspace
 * email-log guard would stop a 1,000-recipient campaign at the default 600
 * rows/hour limit. Keep the hourly guard for every other email path, including
 * interactive/test sends and campaign messages that are delivered immediately.
 */
export const shouldEnforceWorkspaceHourlyEmailLimit = (
  input: Pick<WorkspaceEmailInput, "autoDeliver" | "emailClassification" | "templateKey">,
) => {
  const classification =
    input.emailClassification ||
    (input.templateKey === "campaign_send" ? "CAMPAIGN" : undefined);
  return !(classification === "CAMPAIGN" && input.autoDeliver === false);
};

/**
 * Email connections belong to the workspace owner, not to whichever member
 * happened to trigger a module action. Most callers already pass the owner
 * id, but interactive actions and background work can legitimately start with
 * a member id. Resolve that boundary here so every outbound message uses the
 * same provider, identity, suppression list, rate limit, and audit log.
 */
const workspaceEmailInput = async (input: WorkspaceEmailInput) => {
  const workspaceId = await workspaceScopeFor(input.userId);
  return workspaceId === input.userId
    ? input
    : { ...input, userId: workspaceId };
};

const inferEmailClassification = (input: WorkspaceEmailInput, module: string, templateKey: string) => {
  if (input.emailClassification) return input.emailClassification;
  const normalized = `${module}:${templateKey}`.toLowerCase();
  if (normalized.includes("campaign") || normalized.startsWith("contacts:")) return "CAMPAIGN" as const;
  if (normalized.includes("auth") || normalized.includes("password") || normalized.includes("verification")) return "AUTHENTICATION" as const;
  if (normalized.includes("appointment") || normalized.includes("booking")) return "APPOINTMENT" as const;
  if (normalized.includes("event") || normalized.includes("ticket")) return "EVENT" as const;
  if (normalized.includes("document") || normalized.includes("file")) return "DOCUMENT" as const;
  if (normalized.includes("form")) return "FORM_NOTIFICATION" as const;
  return "TRANSACTIONAL" as const;
};

const sharedSender = (workspaceName = "MaxForm workspace") =>
  managedSenderEmail(normalizeManagedSenderPrefix(workspaceName) || "maxform", managedSenderDomain());

const cleanEmailHeaders = (value: Record<string, string> | undefined) =>
  Object.fromEntries(
    Object.entries(value || {})
      .filter(([name, headerValue]) =>
        /^[A-Za-z0-9-]{1,80}$/.test(name) &&
        typeof headerValue === "string" &&
        !/[\r\n]/.test(headerValue),
      )
      .slice(0, 20)
      .map(([name, headerValue]) => [name, headerValue.slice(0, 2_000)]),
  );

export async function sendWorkspaceEmail(input: WorkspaceEmailInput) {
  input = await workspaceEmailInput(input);
  await ensureEmailWorkspace(input.userId);
  const recipient = cleanText(input.to, 320).toLowerCase();
  if (!validEmail(recipient)) throw new WorkspaceEmailError("Enter a valid recipient email address.");
  const sql = database();
  const suppressed = await sql.query(`SELECT id, reason FROM email_suppressions WHERE user_id = $1 AND LOWER(recipient) = LOWER($2) LIMIT 1`, [input.userId, recipient]);
  const requestedClassification = input.emailClassification || (input.templateKey === "campaign_send" ? "CAMPAIGN" : undefined);
  const marketingSend = requestedClassification === "MARKETING" || requestedClassification === "CAMPAIGN";
  if (suppressed[0] && (marketingSend || String((suppressed[0] as DatabaseRow).reason || "") !== "unsubscribe")) {
    throw new WorkspaceEmailError("This recipient is suppressed after an unsubscribe, bounce, or complaint.", 409, "recipient_suppressed");
  }
  const settingsRows = await sql.query(`SELECT * FROM email_settings WHERE user_id = $1 LIMIT 1`, [input.userId]);
  const settings = settingsRows[0] as DatabaseRow;
  if (shouldEnforceWorkspaceHourlyEmailLimit(input)) {
    const sentThisHour = await sql.query(`SELECT COUNT(*)::int AS count FROM email_logs WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 hour'`, [input.userId]);
    if (Number((sentThisHour[0] as DatabaseRow | undefined)?.count || 0) >= Number(settings.rate_limit_per_hour || 600)) throw new WorkspaceEmailError("This workspace has reached its email rate limit. Try again shortly.", 429, "email_rate_limited", true);
  }
  const key = cleanText(input.idempotencyKey, 180) || null;
  if (key) {
    const existing = await sql.query(`SELECT id, status FROM email_logs WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`, [input.userId, key]);
    if (existing[0]) return { id: cleanText((existing[0] as DatabaseRow).id, 64), status: cleanText((existing[0] as DatabaseRow).status, 24), duplicate: true };
  }
  const requestedTemplateKey = cleanText(input.templateKey, 100);
  const sourceEventId = isUuid(cleanText(input.sourceEventId, 64)) ? cleanText(input.sourceEventId, 64) : "";
  if (sourceEventId && requestedTemplateKey.startsWith("event_")) {
    const eventRows = await sql.query(`SELECT settings FROM events WHERE id = $1 AND created_by = $2 LIMIT 1`, [sourceEventId, input.userId]);
    if (!eventRows[0]) throw new WorkspaceEmailError("This event email is no longer available.", 404, "event_not_found");
    const eventSettings = eventRows[0].settings && typeof eventRows[0].settings === "object"
      ? eventRows[0].settings as DatabaseRow
      : {};
    const mailSettings = eventSettings.mailSettings && typeof eventSettings.mailSettings === "object"
      ? eventSettings.mailSettings as DatabaseRow
      : {};
    const setting = mailSettings[requestedTemplateKey];
    const enabled = setting && typeof setting === "object"
      ? (setting as DatabaseRow).enabled !== false
      : setting !== false;
    if (!enabled) return { id: "", status: "skipped", duplicate: false };
  }
  const templates = input.override
    ? []
    : await sql.query(`SELECT * FROM email_templates WHERE user_id = $1 AND key = $2 LIMIT 1`, [input.userId, requestedTemplateKey]);
  const template = templates[0] as DatabaseRow | undefined;
  if (!input.override && !template) throw new WorkspaceEmailError("This email template was not found.", 404);
  const requestedIdentityId = cleanText(input.identityId, 64) || null;
  const selectedIdentityId = requestedIdentityId || cleanText(settings.default_identity_id, 64) || null;
  const identities = selectedIdentityId ? await sql.query(`SELECT * FROM email_identities WHERE id = $1 AND user_id = $2 LIMIT 1`, [selectedIdentityId, input.userId]) : await sql.query(`SELECT * FROM email_identities WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`, [input.userId]);
  const identity = identities[0] as DatabaseRow | undefined;
  if (requestedIdentityId && !identity) throw new WorkspaceEmailError("Choose a sender identity from this workspace.", 404);
  const userRows = await sql.query(
    `SELECT user_account.full_name,
            COALESCE(company.company_name, user_account.full_name, '') AS workspace_name,
            COALESCE(company.company_logo_url, '') AS workspace_logo_url,
            COALESCE(event_preferences.support_email, '') AS workspace_support_email
     FROM users user_account
     LEFT JOIN company_settings company ON company.user_id = user_account.id
     LEFT JOIN event_module_preferences event_preferences
       ON event_preferences.user_id = user_account.id
     WHERE user_account.id = $1 LIMIT 1`,
    [input.userId],
  );
  const user = userRows[0] as DatabaseRow | undefined;
  const suppliedWorkspace = input.variables?.workspace && typeof input.variables.workspace === "object" && !Array.isArray(input.variables.workspace)
    ? input.variables.workspace as DatabaseRow
    : {};
  const variables = {
    ...(input.variables || {}),
    workspace: {
      ...suppliedWorkspace,
      name: cleanText(user?.workspace_name, 160) || cleanText(user?.full_name, 160) || "MaxForm workspace",
      logoUrl: cleanText(user?.workspace_logo_url, 2_500_000) || cleanText(suppliedWorkspace.logoUrl, 2_500_000),
      supportEmail: cleanText(user?.workspace_support_email, 320) || cleanText(suppliedWorkspace.supportEmail, 320),
    },
  };
  const subject = render(input.override?.subject || String(template?.subject || ""), variables);
  const html = render(input.override?.html || String(template?.html_body || ""), variables, true);
  const text = render(input.override?.text || String(template?.text_body || "") || plainText(html), variables);
  const replyTo = cleanText(input.override?.replyTo, 320).toLowerCase() || cleanText(identity?.reply_to, 320).toLowerCase() || "";
  if (replyTo && !validEmail(replyTo)) throw new WorkspaceEmailError("Enter a valid reply-to email address.", 400, "invalid_sender_identity");
  if (!subject || !html) throw new WorkspaceEmailError("The email subject and message cannot be empty.");
  const mockMode = String(process.env.EMAIL_PROVIDER || "").trim().toLowerCase() === "mock";
  const active = await activeDelivery(sql, input.userId);
  const managedMode = active?.mode === "managed";
  const adminManagedProvider = managedMode && managedSendingConfigured();
  const activeProvider = (mockMode ? "mock" : active?.provider || "") as EmailProviderId | "";
  if (!active && !mockMode) throw new WorkspaceEmailError("Choose an active email provider before sending emails.", 409, "provider_required");
  if (managedMode && !adminManagedProvider) throw new WorkspaceEmailError("MaxForm Managed Sending is temporarily unavailable. Contact your workspace administrator or choose another connected provider.", 503, "managed_sender_unavailable");
  if (identity) {
    if (!identitySenderReady(identity)) throw new WorkspaceEmailError(identitySenderError(identity), 422, identityMode(identity) === "custom" ? "custom_domain_unverified" : "managed_sender_unavailable");
    if (!mockMode && !managedMode && identityMode(identity) === "custom" && activeProvider && !["smtp", "sender"].includes(activeProvider)) {
      const verified = await sql.query(
        `SELECT domain_record.id
         FROM email_sending_domains domain_record
         JOIN email_provider_connections connection ON connection.id = domain_record.provider_connection_id
         WHERE domain_record.user_id = $1
           AND LOWER(domain_record.domain) = LOWER($2)
           AND domain_record.status = 'verified'
           AND connection.provider = $3
           AND connection.role = 'primary'
           AND connection.status = 'connected'
         LIMIT 1`,
        [input.userId, cleanText(identity.custom_domain || identity.domain, 255), activeProvider],
      );
      if (!verified[0]) throw customDomainUnverified(cleanText(identity.custom_domain || identity.domain, 255));
    }
  }
  const workspaceName = cleanText(user?.workspace_name, 160) || cleanText(user?.full_name, 160) || "MaxForm workspace";
  const resolvedSenderEmail = identity ? identityEffectiveSender(identity) : sharedSender(workspaceName);
  if (!validEmail(resolvedSenderEmail)) throw managedSenderUnavailable();
  const sender = `${cleanText(identity?.sender_name, 160) || workspaceName || "MaxForm"} <${resolvedSenderEmail}>`;
  const emailType = cleanText(input.override?.module || template?.module || "workflows", 40);
  const emailClassification = inferEmailClassification(input, emailType, requestedTemplateKey);
  const relatedTicketIds = safeUuidList(input.relatedTicketIds);
  const customHeaders = cleanEmailHeaders(input.headers);
  const scheduledFor = input.scheduledFor instanceof Date
    ? input.scheduledFor.toISOString()
    : cleanText(input.scheduledFor, 64) || null;
  let logs: DatabaseRow[];
  try {
    logs = await sql.query(`INSERT INTO email_logs (user_id, template_key, module, email_type, email_classification, identity_id, recipient, from_address, reply_to, subject, html_body, text_body, status, source_event_id, related_ticket_ids, idempotency_key, custom_headers, next_attempt_at, created_at, updated_at) VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'queued', $12, $13::jsonb, $14, $15::jsonb, COALESCE($16::timestamptz, NOW()), NOW(), NOW()) RETURNING id, status`, [input.userId, cleanText(input.templateKey || template?.key, 100), emailType, emailClassification, selectedIdentityId, recipient, sender, replyTo, subject, html, text, isUuid(cleanText(input.sourceEventId, 64)) ? input.sourceEventId : null, JSON.stringify(relatedTicketIds), key, JSON.stringify(customHeaders), scheduledFor]);
  } catch (error) {
    // Two webhook workers can pass the read-before-insert check together. The
    // database unique index is the final idempotency authority; return its
    // existing row instead of turning a legitimate duplicate into a failure.
    const code = error && typeof error === "object" ? String((error as { code?: unknown }).code || "") : "";
    if (key && code === "23505") {
      const existing = await sql.query(`SELECT id, status FROM email_logs WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`, [input.userId, key]);
      if (existing[0]) return { id: cleanText((existing[0] as DatabaseRow).id, 64), status: cleanText((existing[0] as DatabaseRow).status, 24), duplicate: true };
    }
    throw error;
  }
  const log = logs[0] as DatabaseRow;
  const id = cleanText(log.id, 64);
  if (input.autoDeliver !== false) {
    void enqueueTransactionalEmailJob(id, scheduledFor)
      .then((queued) => {
        if (!queued.enqueued) queueMicrotask(() => { void deliverWorkspaceEmail(id); });
      })
      .catch(async (error) => {
        // Production must not silently fall back to an in-process send when
        // the durable queue is unavailable. Local development keeps the old
        // compatibility path so a developer can run without Redis.
        if (process.env.NODE_ENV === "production" || process.env.QUEUE_REQUIRED === "true") {
          console.error("[transactional-email] queue enqueue failed", {
            type: error instanceof Error ? error.name : typeof error,
          });
          await sql.query(
            `UPDATE email_logs SET status = 'failed', last_error = 'The transactional email queue is unavailable.', updated_at = NOW() WHERE id = $1`,
            [id],
          );
          return;
        }
        queueMicrotask(() => { void deliverWorkspaceEmail(id); });
      });
  }
  return { id, status: "queued", duplicate: false };
}

const recordDeliveryAttempt = async (
  sql: ReturnType<typeof database>,
  log: DatabaseRow,
  input: {
    provider: string;
    status: "accepted" | "retryable" | "failed" | "unknown";
    providerMessageId?: string;
    errorCategory?: string;
    errorMessage?: string;
    response?: Record<string, unknown>;
  },
) => {
  try {
    await sql.query(
      `INSERT INTO email_delivery_attempts (
         email_log_id, user_id, provider, attempt_number, status,
         provider_message_id, error_category, error_message, provider_response
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        String(log.id),
        String(log.user_id),
        input.provider,
        Math.max(1, Number(log.attempt_count || 1)),
        input.status,
        cleanText(input.providerMessageId, 255),
        cleanText(input.errorCategory, 120),
        cleanText(input.errorMessage, 1_000),
        JSON.stringify(input.response || {}),
      ],
    );
  } catch {
    // Delivery history is valuable, but an unavailable audit table must not
    // turn an already accepted provider response into a failed send.
  }
};

const batchChunks = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

/**
 * Delivers a homogeneous campaign wave through a provider batch endpoint when
 * one exists. Each log row remains the idempotency and analytics boundary; a
 * partial provider response can therefore update only the affected recipient.
 */
export type WorkspaceEmailDeliveryOptions = {
  /**
   * Durable workers retry temporary provider failures. Interactive sends turn
   * the same outcome into an immediate, visible failure instead of leaving the
   * caller looking at a queued message for several minutes.
   */
  retryOnTemporaryFailure?: boolean;
};

export const shouldRetryWorkspaceEmailDelivery = (input: {
  retryable: boolean;
  attemptCount: number;
  retryOnTemporaryFailure?: boolean;
  maxAttempts?: number;
}) =>
  input.retryOnTemporaryFailure !== false &&
  input.retryable &&
  Math.max(0, Math.floor(Number(input.attemptCount) || 0)) <
    Math.max(1, Math.floor(Number(input.maxAttempts) || 3));

export const deliverWorkspaceEmailBatch = async (
  requestedLogIds: string[],
  options: WorkspaceEmailDeliveryOptions = {},
) => {
  const logIds = Array.from(new Set(requestedLogIds.filter(isUuid))).slice(0, 500);
  if (!logIds.length) return { accepted: 0, failed: 0, queued: 0, unknown: 0, logIds: [] as string[] };
  const sql = database();
  const logs = (await sql.query(
    `UPDATE email_logs
     SET status = 'sending', attempt_count = attempt_count + 1, updated_at = NOW()
     WHERE id = ANY($1::uuid[]) AND status = 'queued' AND next_attempt_at <= NOW()
     RETURNING *`,
    [logIds],
  )) as DatabaseRow[];
  if (!logs.length) return { accepted: 0, failed: 0, queued: 0, unknown: 0, logIds: [] as string[] };

  const userId = String(logs[0].user_id);
  if (logs.some((log) => String(log.user_id) !== userId)) {
    await sql.query(`UPDATE email_logs SET status = 'queued', updated_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'sending'`, [logs.map((log) => String(log.id))]);
    for (const log of logs) {
      await deliverWorkspaceEmail(String(log.id), options);
    }
    return { accepted: 0, failed: 0, queued: logs.length, unknown: 0, logIds: logs.map((log) => String(log.id)) };
  }

  // Suppression is checked again after the durable claim. Marketing messages
  // must never race an unsubscribe, bounce, or complaint received mid-wave.
  const blocked = (await sql.query(
    `SELECT log.id
     FROM email_logs log
     LEFT JOIN email_suppressions suppression
       ON suppression.user_id = log.user_id
      AND LOWER(TRIM(suppression.recipient)) = LOWER(TRIM(log.recipient))
     LEFT JOIN contacts contact
       ON contact.created_by = log.user_id
      AND LOWER(TRIM(contact.email)) = LOWER(TRIM(log.recipient))
     WHERE log.id = ANY($1::uuid[])
       AND (
         (log.email_classification IN ('MARKETING', 'CAMPAIGN') AND (suppression.id IS NOT NULL OR contact.unsubscribed_at IS NOT NULL))
         OR (suppression.reason IN ('bounce', 'complaint', 'manual'))
       )
     GROUP BY log.id`,
    [logs.map((log) => String(log.id))],
  )) as DatabaseRow[];
  const blockedIds = blocked.map((row) => String(row.id));
  if (blockedIds.length) {
    await sql.query(
      `UPDATE email_logs
       SET status = 'skipped', last_error = 'Recipient is suppressed.', updated_at = NOW()
       WHERE id = ANY($1::uuid[]) AND status = 'sending'`,
      [blockedIds],
    );
  }
  const eligible = logs.filter((log) => !blockedIds.includes(String(log.id)));
  if (!eligible.length) return { accepted: 0, failed: 0, queued: 0, unknown: 0, logIds: logs.map((log) => String(log.id)) };

  const active = await activeDelivery(sql, userId);
  const mockMode = String(process.env.EMAIL_PROVIDER || "").trim().toLowerCase() === "mock";
  const managedDelivery = Boolean(active?.mode === "managed" && managedSendingConfigured());
  const connection = mockMode
    ? { provider: "mock", mock: true }
    : managedDelivery
      ? { provider: "resend", managed_admin: true }
      : active?.connection;
  if (!connection) {
    await sql.query(`UPDATE email_logs SET status = 'failed', last_error = 'Choose an active email provider before sending emails.', updated_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'sending'`, [eligible.map((log) => String(log.id))]);
    return { accepted: 0, failed: eligible.length, queued: 0, unknown: 0, logIds: logs.map((log) => String(log.id)) };
  }

  const provider = String(connection.provider) as EmailProviderId;
  const adapter = emailProviderAdapter(provider);
  if (!adapter.sendBatch) {
    await sql.query(`UPDATE email_logs SET status = 'queued', updated_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'sending'`, [eligible.map((log) => String(log.id))]);
    for (const log of eligible) {
      await deliverWorkspaceEmail(String(log.id), options);
    }
    return { accepted: 0, failed: 0, queued: eligible.length, unknown: 0, logIds: logs.map((log) => String(log.id)) };
  }

  const credentials = connection.mock === true
    ? {}
    : connection.managed_admin === true
      ? managedResendCredentials()
      : decryptCredentials(String(connection.credentials_encrypted || ""));
  const maximumBatchSize = provider === "tosend"
    ? 100
    : Math.max(1, Math.min(100, eligible.length));
  let accepted = 0;
  let failed = 0;
  let queued = 0;
  let unknown = 0;
  for (const chunk of batchChunks(eligible, maximumBatchSize)) {
    const inputs = chunk.map((log) => ({
      from: senderAddress(cleanText(log.from_address, 500)),
      replyTo: cleanText(log.reply_to, 320) || undefined,
      to: cleanText(log.recipient, 320),
      subject: cleanText(log.subject, 998),
      html: String(log.html_body || ""),
      text: String(log.text_body || ""),
      headers: log.custom_headers && typeof log.custom_headers === "object" && !Array.isArray(log.custom_headers)
        ? cleanEmailHeaders(log.custom_headers as Record<string, string>)
        : {},
      messageHash: cleanText(log.idempotency_key, 255) || `maxform-${String(log.id)}`,
      tags: { module: cleanText(log.module, 40), classification: cleanText(log.email_classification, 40) },
    }));
    let result;
    try {
      result = await adapter.sendBatch(credentials, inputs);
    } catch (error) {
      const safe = providerUserError(error, "Email delivery could not be completed.");
      const ambiguous = safe.code === "provider_network_error" || safe.code === "provider_timeout";
      for (const log of chunk) {
        if (ambiguous) {
          unknown += 1;
          await sql.query(
            `UPDATE email_logs SET status = 'unknown', uncertain_at = NOW(), last_error = $2, provider_error_detail = $3, updated_at = NOW() WHERE id = $1::uuid AND status = 'sending'`,
            [String(log.id), "The provider response was uncertain. Reconciliation is required before retrying.", safe.detail],
          );
        } else if (safe.retryable && options.retryOnTemporaryFailure !== false) {
          queued += 1;
          await sql.query(
            `UPDATE email_logs SET status = 'queued', next_attempt_at = NOW() + INTERVAL '30 seconds', last_error = $2, provider_error_detail = $3, updated_at = NOW() WHERE id = $1::uuid AND status = 'sending'`,
            [String(log.id), safe.message, safe.detail],
          );
        } else {
          failed += 1;
          await sql.query(
            `UPDATE email_logs SET status = 'failed', last_error = $2, provider_error_detail = $3, updated_at = NOW() WHERE id = $1::uuid AND status = 'sending'`,
            [String(log.id), safe.message, safe.detail],
          );
        }
        await recordDeliveryAttempt(sql, log, { provider, status: ambiguous ? "unknown" : safe.retryable ? "retryable" : "failed", errorCategory: safe.code, errorMessage: safe.message, response: {} });
      }
      continue;
    }
    for (const [index, log] of chunk.entries()) {
      const outcome: ProviderBatchItemResult | undefined = result.results[index];
      if (outcome?.ok) {
        accepted += 1;
        await sql.query(
          `UPDATE email_logs
           SET provider = $2, provider_message_id = $3, provider_response = $4::jsonb,
               status = 'sent', sent_at = NOW(), last_error = '', provider_error_detail = '', updated_at = NOW()
           WHERE id = $1::uuid AND status = 'sending'`,
          [String(log.id), provider, outcome.messageId, JSON.stringify(outcome.response || {})],
        );
        await recordDeliveryAttempt(sql, log, { provider, status: "accepted", providerMessageId: outcome.messageId, response: outcome.response });
      } else {
        // `outcome?.ok` being falsy covers both "no result for this index" and
        // "the provider rejected it", so the union is not narrowed here. Pick
        // out the rejection explicitly; a missing result leaves every field
        // undefined, exactly as the optional chaining did before.
        const failure = outcome?.ok === false ? outcome : undefined;
        const retryable =
          Boolean(failure?.retryable) &&
          options.retryOnTemporaryFailure !== false;
        if (retryable) queued += 1;
        else failed += 1;
        const errorMessage = failure?.error || "The provider rejected this message.";
        await sql.query(
          `UPDATE email_logs
           SET status = $2, next_attempt_at = CASE WHEN $2 = 'queued' THEN NOW() + INTERVAL '30 seconds' ELSE next_attempt_at END,
               last_error = $3, provider_error_detail = $4, updated_at = NOW()
           WHERE id = $1::uuid AND status = 'sending'`,
          [String(log.id), retryable ? "queued" : "failed", errorMessage, failure?.code || "provider_request_failed"],
        );
        await recordDeliveryAttempt(sql, log, { provider, status: retryable ? "retryable" : "failed", errorCategory: failure?.code, errorMessage, response: failure?.response });
      }
    }
  }
  return { accepted, failed, queued, unknown, logIds: logs.map((log) => String(log.id)) };
};

export const deliverWorkspaceEmail = async (
  logId: string,
  options: WorkspaceEmailDeliveryOptions = {},
) => {
  if (!isUuid(logId)) return;
  const sql = database();
  // Claim the queue row atomically. The normal queue worker and explicit
  // dispatch paths can both call this function; only one may deliver a log.
  const logs = await sql.query(`UPDATE email_logs SET status = 'sending', attempt_count = attempt_count + 1, updated_at = NOW() WHERE id = $1 AND status = 'queued' AND next_attempt_at <= NOW() RETURNING *`, [logId]);
  if (!logs[0]) return;
  const log = logs[0] as DatabaseRow;
  const sourceEventId = cleanText(log.source_event_id, 64);
  const templateKey = cleanText(log.template_key, 100);
  if (sourceEventId && isUuid(sourceEventId) && templateKey.startsWith("event_")) {
    const eventRows = await sql.query(
      `SELECT settings FROM events WHERE id = $1 AND created_by = $2 LIMIT 1`,
      [sourceEventId, String(log.user_id)],
    );
    const eventSettings = eventRows[0]?.settings && typeof eventRows[0].settings === "object"
      ? eventRows[0].settings as DatabaseRow
      : {};
    const mailSettings = eventSettings.mailSettings && typeof eventSettings.mailSettings === "object"
      ? eventSettings.mailSettings as DatabaseRow
      : {};
    const setting = mailSettings[templateKey];
    const enabled = setting && typeof setting === "object"
      ? (setting as DatabaseRow).enabled !== false
      : setting !== false;
    if (!eventRows[0] || !enabled) {
      await sql.query(
        `UPDATE email_logs SET status = 'skipped', last_error = '', updated_at = NOW() WHERE id = $1`,
        [logId],
      );
      return;
    }
  }
  // Campaign deletion cancels queued delivery. A worker that was already
  // retrying a provider request can still wake up after the campaign row has
  // gone, so do not resurrect that message on its next attempt.
  if (
    cleanText(log.module, 40) === "contacts" &&
    sourceEventId &&
    isUuid(sourceEventId)
  ) {
    const campaignRows = await sql.query(
      `SELECT id
       FROM contact_campaigns
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [sourceEventId, String(log.user_id)],
    );
    if (!campaignRows[0]) {
      await sql.query(
        `UPDATE email_logs
         SET status = 'skipped',
             last_error = 'Campaign deleted before delivery.',
             updated_at = NOW()
         WHERE id = $1`,
        [logId],
      );
      return;
    }
  }
  // A queued message may be retrying after a transient provider failure. Keep
  // the active assignment authoritative for retries even while its health flag
  // is temporarily false; new sends are still blocked until health is restored.
  const active = await activeDelivery(sql, String(log.user_id));
  const fallbackSettings = (await sql.query(
    `SELECT fallback_enabled, fallback_provider
     FROM email_settings WHERE user_id = $1 LIMIT 1`,
    [String(log.user_id)],
  )) as DatabaseRow[];
  const fallbackEnabled = fallbackSettings[0]?.fallback_enabled === true;
  const fallbackProvider = cleanText(fallbackSettings[0]?.fallback_provider, 32);
  const fallbackRows = fallbackEnabled && isProvider(fallbackProvider)
    ? (await sql.query(
        `SELECT * FROM email_provider_connections
         WHERE user_id = $1 AND provider = $2 AND role = 'fallback'
           AND status = 'connected'
         LIMIT 1`,
        [String(log.user_id), fallbackProvider],
      )) as DatabaseRow[]
    : [];
  if (active?.mode === "managed" && !managedSendingConfigured() && !fallbackRows[0]) {
    await sql.query(`UPDATE email_logs SET status = 'failed', last_error = 'MaxForm Managed Sending is temporarily unavailable. Contact your workspace administrator or choose another connected provider.', updated_at = NOW() WHERE id = $1`, [logId]);
    return;
  }
  const mockMode = String(process.env.EMAIL_PROVIDER || "").trim().toLowerCase() === "mock";
  const managedDelivery = Boolean(active?.mode === "managed" && managedSendingConfigured());
  const primaryConnections = mockMode
    ? [{ provider: "mock", mock: true }]
    : managedDelivery
    ? [{ provider: "resend", managed_admin: true }]
      : active?.connection
        ? [active.connection]
      : [];
  const connections = [
    ...primaryConnections,
    ...(mockMode || !fallbackRows[0] || fallbackRows[0].provider === active?.provider
      ? []
      : [fallbackRows[0]]),
  ];
  if (!connections[0]) {
    await sql.query(`UPDATE email_logs SET status = 'failed', last_error = 'Choose an active email provider before sending emails.', updated_at = NOW() WHERE id = $1`, [logId]);
    return;
  }
  const candidates = connections as DatabaseRow[];
  let lastError: WorkspaceEmailError | null = null;
  let lastDetail = "";
  for (const [index, connection] of candidates.entries()) {
    try {
      const provider = cleanText(connection.provider, 32) as EmailProviderId;
      const credentials = connection.mock === true
        ? {}
        : connection.managed_admin === true
        ? managedResendCredentials()
        : decryptCredentials(String(connection.credentials_encrypted || ""));
      const storedHeaders = log.custom_headers && typeof log.custom_headers === "object" && !Array.isArray(log.custom_headers)
        ? cleanEmailHeaders(log.custom_headers as Record<string, string>)
        : {};
      const result = await sendWithProvider(provider, credentials, { from: cleanText(log.from_address, 500) || sharedSender(), replyTo: cleanText(log.reply_to, 320), to: cleanText(log.recipient, 320), subject: cleanText(log.subject, 500), html: String(log.html_body || ""), text: String(log.text_body || ""), headers: storedHeaders });
      await sql.query(`UPDATE email_logs SET provider = $1, provider_message_id = $2, provider_response = $3::jsonb, status = 'sent', sent_at = NOW(), last_error = '', updated_at = NOW() WHERE id = $4`, [provider, result.messageId, JSON.stringify(result.response), logId]);
      if (connection.managed_admin !== true && connection.mock !== true) {
        await sql.query(`UPDATE email_provider_connections SET health_ok = TRUE, status = 'connected', last_health_check_at = NOW(), last_verified_at = NOW(), last_error = '', last_error_detail = '', updated_at = NOW() WHERE id = $1`, [String(connection.id)]);
      }
      return;
    } catch (error) {
      lastError = providerUserError(error);
      lastDetail = lastError.detail;
      if (connection.managed_admin !== true && connection.mock !== true && !new Set(["sender_domain_unverified", "provider_sandbox_restriction"]).has(lastError.code)) {
        await sql.query(`UPDATE email_provider_connections SET health_ok = FALSE, status = 'attention', last_error = $1, last_error_detail = $2, updated_at = NOW() WHERE id = $3`, [lastError.message, lastDetail, String(connection.id)]);
      }
      // A configured fallback is used only after a retryable primary failure.
      // Permanent recipient/domain/compliance failures must remain visible and
      // must not be hidden by another provider.
      if (!lastError.retryable || index >= candidates.length - 1) break;
    }
  }
  const attempts = Number(log.attempt_count || 0);
  if (
    shouldRetryWorkspaceEmailDelivery({
      retryable: Boolean(lastError?.retryable),
      attemptCount: attempts,
      retryOnTemporaryFailure: options.retryOnTemporaryFailure,
    })
  ) {
    const delayMinutes = attempts === 1 ? 1 : 5;
    await sql.query(`UPDATE email_logs SET status = 'queued', next_attempt_at = NOW() + ($1::int * INTERVAL '1 minute'), last_error = $2, provider_error_detail = $3, updated_at = NOW() WHERE id = $4`, [delayMinutes, "Email could not be sent. Please try again.", lastDetail, logId]);
    setTimeout(() => { void deliverWorkspaceEmail(logId); }, delayMinutes * 60_000).unref?.();
    return;
  }
  await sql.query(`UPDATE email_logs SET status = 'failed', last_error = $1, provider_error_detail = $2, updated_at = NOW() WHERE id = $3`, [lastError?.message || "Email could not be sent. Please try again.", lastDetail, logId]);
};

/**
 * Deliver one interactive test message in the request that created it.
 *
 * Test sends are deliberately not handed to Redis/BullMQ: the caller is
 * waiting for provider acceptance and a one-message send does not benefit
 * from a durable queue hop. The email_logs row is still created first so the
 * send remains auditable and idempotent, then the normal atomic delivery path
 * performs the provider call immediately.
 */
export const sendWorkspaceEmailNow = async (input: WorkspaceEmailInput) => {
  const scopedInput = await workspaceEmailInput(input);
  const email = await sendWorkspaceEmail({ ...scopedInput, autoDeliver: false });
  if (!email.id) return email;

  await deliverWorkspaceEmail(email.id, { retryOnTemporaryFailure: false });
  const rows = await database().query(
    `SELECT status, provider, last_error, provider_error_detail
     FROM email_logs
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [email.id, scopedInput.userId],
  );
  const log = rows[0] as DatabaseRow | undefined;
  const status = cleanText(log?.status, 24) || email.status;
  const completed = ["sent", "delivered", "opened", "clicked", "skipped"].includes(status);
  if (!completed) {
    throw new WorkspaceEmailError(
      cleanText(log?.last_error, 1_000) || "Email could not be sent. Please try again.",
      502,
      "email_send_failed",
      false,
      cleanText(log?.provider_error_detail, 2_000),
    );
  }

  return {
    ...email,
    status,
    provider: cleanText(log?.provider, 32),
  };
};

export type StaleEmailRecoveryDecision = "queued" | "failed";

export const staleEmailRecoveryDecision = (
  attemptCount: number,
  maxAttempts = 3,
): StaleEmailRecoveryDecision =>
  Number(attemptCount) >= maxAttempts ? "failed" : "queued";

/**
 * Serverless workers can terminate after claiming a row and before recording
 * the provider result. Requeue short-lived abandoned claims, but stop retrying
 * a row that has already consumed the normal attempt budget.
 */
export const recoverStaleWorkspaceEmails = async (
  requestedLimit = 100,
  requestedAgeMinutes = 10,
) => {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(requestedLimit) || 100)));
  const ageMinutes = Math.max(5, Math.min(1_440, Math.floor(Number(requestedAgeMinutes) || 10)));
  const sql = database();
  const rows = await sql.query(
    `WITH stale AS (
       SELECT id, attempt_count
       FROM email_logs
       WHERE status = 'sending'
         AND updated_at <= NOW() - ($1::int * INTERVAL '1 minute')
       ORDER BY updated_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     UPDATE email_logs log
     SET status = CASE
           WHEN stale.attempt_count >= 3 THEN 'failed'
           ELSE 'queued'
         END,
         next_attempt_at = CASE
           WHEN stale.attempt_count >= 3 THEN log.next_attempt_at
           ELSE NOW()
         END,
         last_error = CASE
           WHEN stale.attempt_count >= 3 THEN 'Email delivery stopped after an interrupted worker attempt.'
           ELSE 'The previous email worker stopped unexpectedly. Retrying automatically.'
         END,
         provider_error_detail = CASE
           WHEN stale.attempt_count >= 3 THEN 'stale_sending_attempt_exhausted'
           ELSE 'stale_sending_attempt_recovered'
         END,
         updated_at = NOW()
     FROM stale
     WHERE log.id = stale.id
     RETURNING log.status`,
    [ageMinutes, limit],
  );
  return {
    recovered: rows.filter((row) => String((row as DatabaseRow).status) === "queued").length,
    failed: rows.filter((row) => String((row as DatabaseRow).status) === "failed").length,
  };
};

export const drainQueuedWorkspaceEmails = async (requestedLimit = 50) => {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(requestedLimit) || 50)));
  const sql = database();
  const recovered = await recoverStaleWorkspaceEmails();
  const queued = await sql.query(
    `SELECT id
     FROM email_logs
     WHERE status = 'queued' AND next_attempt_at <= NOW()
     ORDER BY next_attempt_at ASC, created_at ASC
     LIMIT $1`,
    [limit],
  );
  let sent = 0;
  let failed = 0;
  let stillQueued = 0;
  for (const row of queued as DatabaseRow[]) {
    const id = cleanText(row.id, 64);
    await deliverWorkspaceEmail(id);
    const result = await sql.query(`SELECT status FROM email_logs WHERE id = $1 LIMIT 1`, [id]);
    const status = cleanText((result[0] as DatabaseRow | undefined)?.status, 24);
    if (["sent", "delivered", "opened", "clicked"].includes(status)) sent += 1;
    else if (status === "failed" || status === "bounced" || status === "complained") failed += 1;
    else if (status === "queued" || status === "sending") stillQueued += 1;
  }
  return { attempted: queued.length, sent, failed, stillQueued, recovered };
};

export const retryWorkspaceEmail = async (userId: string, logId: string) => {
  if (!isUuid(logId)) throw new WorkspaceEmailError("Choose a valid email log.");
  const sql = database();
  const senderRows = await sql.query(
    `SELECT identity.id, identity.sender_name, identity.sender_email, identity.reply_to,
            identity.sender_prefix, identity.managed_domain,
            identity.generated_sender_email, identity.sending_mode,
            identity.custom_sender_email, identity.custom_domain,
            identity.domain_verified, users.full_name,
            COALESCE(company.company_name, users.full_name, '') AS workspace_name
     FROM email_logs log
     LEFT JOIN email_identities identity ON identity.user_id = log.user_id
     LEFT JOIN users ON users.id = log.user_id
     LEFT JOIN company_settings company ON company.user_id = log.user_id
     WHERE log.id = $1 AND log.user_id = $2 AND log.status = 'failed'
     ORDER BY identity.is_default DESC, identity.updated_at DESC
     LIMIT 1`,
    [logId, userId],
  );
  const identity = senderRows[0] as DatabaseRow | undefined;
  const identityId = cleanText(identity?.id, 64) || null;
  const workspaceName = cleanText(identity?.workspace_name, 160) || cleanText(identity?.full_name, 160) || "MaxForm workspace";
  const resolvedSenderEmail = identity ? identityEffectiveSender(identity) : sharedSender(workspaceName);
  if (!validEmail(resolvedSenderEmail)) throw managedSenderUnavailable();
  const fromAddress = identity
    ? `${cleanText(identity.sender_name, 160) || "MaxForm"} <${resolvedSenderEmail}>`
    : `${workspaceName} <${resolvedSenderEmail}>`;
  const replyTo = cleanText(identity?.reply_to, 320);
  const rows = await sql.query(`UPDATE email_logs SET identity_id = $1, from_address = $2, reply_to = $3, status = 'queued', next_attempt_at = NOW(), last_error = '', updated_at = NOW() WHERE id = $4 AND user_id = $5 AND status = 'failed' RETURNING id`, [identityId, fromAddress, replyTo, logId, userId]);
  if (!rows[0]) throw new WorkspaceEmailError("Only a failed email can be retried.", 409);
  await deliverWorkspaceEmail(logId, { retryOnTemporaryFailure: false });
  const deliveredRows = await sql.query(
    `SELECT status, provider, last_error, provider_error_detail
     FROM email_logs
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [logId, userId],
  );
  const delivery = deliveredRows[0] as DatabaseRow | undefined;
  const status = cleanText(delivery?.status, 24);
  if (!["sent", "delivered", "opened", "clicked", "skipped"].includes(status)) {
    throw new WorkspaceEmailError(
      cleanText(delivery?.last_error, 1_000) || "Email could not be sent. Please try again.",
      502,
      "email_send_failed",
      false,
      cleanText(delivery?.provider_error_detail, 2_000),
    );
  }
  return { id: logId, status, provider: cleanText(delivery?.provider, 32) };
};

export const deleteEmailLogs = async (userId: string, input: { ids?: string[]; all?: boolean }) => {
  const sql = database();
  const ids = Array.from(new Set((input.ids || []).filter(isUuid))).slice(0, 200);
  if (!input.all && !ids.length) throw new WorkspaceEmailError("Select at least one email log.");

  const where = input.all
    ? `user_id = $1`
    : `user_id = $1 AND id = ANY($2::uuid[])`;
  const params = input.all ? [userId] : [userId, ids];
  const activeRows = input.all
    ? await sql.query(`SELECT COUNT(*)::int AS count FROM email_logs WHERE user_id = $1 AND status IN ('queued', 'sending')`, [userId])
    : [];
  const rows = await sql.query(
    `DELETE FROM email_logs
     WHERE ${where}
       AND status NOT IN ('queued', 'sending')
     RETURNING id`,
    params,
  );
  return {
    deleted: rows.length,
    skippedActive: input.all ? Number((activeRows[0] as DatabaseRow | undefined)?.count || 0) : ids.length - rows.length,
    ids: rows.map((row) => String((row as DatabaseRow).id || "")).filter(Boolean),
  };
};

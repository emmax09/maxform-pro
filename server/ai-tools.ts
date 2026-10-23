/**
 * What the assistant can actually do.
 *
 * Each tool is a thin wrapper over a function a module already exposes -- the
 * same code path the UI uses -- so a new module gets assistant support by
 * registering its API here rather than by growing a bespoke AI integration.
 *
 * The rule this file exists to enforce: **the AI has no privileged bypass**.
 *
 *   * Every tool declares the module it belongs to, and is only offered, and
 *     only runs, when `canOpenModule()` says this person may open that module
 *     in the UI. The check runs again at execution time -- the list the model
 *     was shown is a hint, never an authorisation.
 *   * Every tool receives the workspace id resolved from the caller's session
 *     token. Tool arguments cannot carry a workspace id, so no prompt can
 *     steer a call into another workspace's rows.
 *   * A tool that sends mail, moves money, or destroys a record is marked
 *     consequential. Those never run from a model turn: they return a preview
 *     for a human to approve, and only the confirm endpoint executes them.
 */
import { neon } from "@neondatabase/serverless";

import {
  listContactActivity,
  listContactNotes,
  listContacts,
  getContact,
  createContactNote,
} from "./contacts-data";
import { listAnalytics } from "./analytics-data";
import { sendEmailNow } from "./email-service";
import {
  getOrderDetail,
  getOrdersSummary,
  listOrders,
} from "./orders-data";
import {
  hasConnectedPaymentProviderServer,
  listPaymentProductsServer,
} from "./payment-data";
import { listWorkspaceNotifications } from "./notifications-data";
import {
  createAppointmentForAssistant,
  createBookingPageForAssistant,
  createEventForAssistant,
  createFormForAssistant,
  formFieldSchema,
} from "./ai-module-actions";
import {
  canOpenModule,
  type WorkspaceContext,
} from "./workspace-access";
import {
  aiModuleAccessEnabled,
  aiModuleAccessFor,
  type AiModuleAccessSetting,
} from "./ai-module-access";
import type { AiToolDefinition } from "./ai-provider";
import type { WorkspaceModuleKey } from "../src/lib/workspace-modules";

export class AiToolError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "ai_tool_error",
  ) {
    super(message);
  }
}

export type AiTool = {
  name: string;
  /**
   * Written for the model: what it does and when to reach for it. Kept
   * prescriptive, because a description that only says what a tool is leaves
   * the model guessing about when it applies.
   */
  description: string;
  /** The module whose permission gates this tool, matching the dashboard rail. */
  module: WorkspaceModuleKey;
  inputSchema: Record<string, unknown>;
  /**
   * True for anything that sends a message, moves money, or destroys data.
   * These are proposed and previewed, never executed from a model turn.
   */
  consequential: boolean;
  /** One line shown on the confirmation card before a human approves. */
  preview?: (input: Record<string, unknown>) => string;
  run: (
    input: Record<string, unknown>,
    context: WorkspaceContext,
  ) => Promise<unknown>;
};

/* -------------------------------------------------------------------------- */
/* Argument readers                                                           */
/* -------------------------------------------------------------------------- */

const text = (value: unknown, max = 400) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const requiredText = (value: unknown, field: string, max = 400) => {
  const result = text(value, max);
  if (!result) throw new AiToolError(`\`${field}\` is required.`);
  return result;
};

const boundedNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requiredId = (value: unknown, field: string) => {
  const result = text(value, 64);
  if (!uuidPattern.test(result)) {
    throw new AiToolError(`\`${field}\` is not a valid id.`);
  }
  return result;
};

const emailAddress = (value: unknown) => {
  const result = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new AiToolError("`to` is not a valid email address.");
  }
  return result;
};

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/* -------------------------------------------------------------------------- */
/* Module snapshots                                                           */
/* -------------------------------------------------------------------------- */

const workspaceDatabase = () => {
  const url = String(process.env.DATABASE_URL || "").trim();
  return url ? neon(url) : null;
};

const safeCount = async (
  workspaceId: string,
  table: string,
  ownerColumn: string,
  where = "TRUE",
) => {
  const sql = workspaceDatabase();
  if (!sql) return 0;
  try {
    const rows = (await sql.query(
      `SELECT COUNT(*)::int AS count FROM ${table}
       WHERE ${ownerColumn} = $1 AND ${where}`,
      [workspaceId],
    )) as Array<Record<string, unknown>>;
    return Number(rows[0]?.count) || 0;
  } catch {
    // A module may be disabled or on an older migration level. The AI should
    // describe the data it can read, not turn one missing optional table into
    // a workspace-wide failure.
    return 0;
  }
};

const moduleSnapshot = async (
  module: string,
  workspaceId: string,
  counters: Array<[string, string, string, string?]>,
) => {
  const values = await Promise.all(
    counters.map(async ([label, table, ownerColumn, where]) => [
      label,
      await safeCount(workspaceId, table, ownerColumn, where),
    ] as const),
  );
  return {
    module,
    generatedAt: new Date().toISOString(),
    counts: Object.fromEntries(values),
  };
};

/**
 * A current, permission-filtered view of the workspace. Individual tools are
 * still preferable for a focused question, but this gives MaxAI one reliable
 * starting point when somebody asks what is happening across the workspace.
 */
const workspaceSnapshot = async (context: WorkspaceContext) => {
  const settings = await aiModuleAccessFor(context);
  const aiAccess = new Map(
    settings.map((setting) => [setting.module, setting.accessEnabled]),
  );
  const readable = async (module: string) =>
    (await canOpenModule(context.userId, module)) &&
    aiAccess.get(module as WorkspaceModuleKey) !== false;

  const readers: Record<string, () => Promise<unknown>> = {
    forms: () =>
      moduleSnapshot("forms", context.workspaceId, [
        ["forms", "forms", "created_by"],
        ["publishedForms", "forms", "created_by", "status = 'published'"],
        ["workflows", "workflows", "created_by"],
      ]),
    events: () =>
      moduleSnapshot("events", context.workspaceId, [
        ["events", "events", "created_by"],
        [
          "liveEvents",
          "events",
          "created_by",
          "status IN ('published', 'on_sale', 'sold_out')",
        ],
        ["upcomingEvents", "events", "created_by", "starts_at >= NOW()"],
      ]),
    appointments: () =>
      moduleSnapshot("appointments", context.workspaceId, [
        ["bookingPages", "booking_pages", "user_id"],
        ["upcomingBookings", "appointments", "user_id", "starts_at >= NOW()"],
        ["noShows", "appointments", "user_id", "status = 'no_show'"],
      ]),
    campaigns: () =>
      moduleSnapshot("campaigns", context.workspaceId, [
        ["campaigns", "contact_campaigns", "user_id"],
        [
          "activeCampaigns",
          "contact_campaigns",
          "user_id",
          "status IN ('scheduled', 'sending')",
        ],
        ["sentCampaigns", "contact_campaigns", "user_id", "status = 'sent'"],
      ]),
    workflows: () =>
      moduleSnapshot("workflows", context.workspaceId, [
        ["workflows", "workspace_workflows", "workspace_id"],
        ["enabledWorkflows", "workspace_workflows", "workspace_id", "enabled = TRUE"],
        ["formAutomations", "workflows", "created_by"],
      ]),
    documents: () =>
      moduleSnapshot("documents", context.workspaceId, [
        ["templates", "document_templates", "user_id"],
        ["documents", "workspace_documents", "user_id"],
        [
          "awaitingSignature",
          "workspace_documents",
          "user_id",
          "status IN ('sent', 'viewed', 'partially_signed')",
        ],
      ]),
    files: () =>
      moduleSnapshot("files", context.workspaceId, [
        ["files", "workspace_files", "user_id", "deleted_at IS NULL"],
        [
          "formUploads",
          "workspace_files",
          "user_id",
          "source_type = 'form_upload' AND deleted_at IS NULL",
        ],
        [
          "eventUploads",
          "workspace_files",
          "user_id",
          "source_type = 'event_upload' AND deleted_at IS NULL",
        ],
      ]),
    integrations: () =>
      moduleSnapshot("integrations", context.workspaceId, [
        ["connections", "integration_connections", "workspace_id"],
        [
          "connected",
          "integration_connections",
          "workspace_id",
          "status = 'connected' AND enabled = TRUE",
        ],
        [
          "needsAttention",
          "integration_connections",
          "workspace_id",
          "status IN ('error', 'reconnect_required', 'expired')",
        ],
      ]),
    emails: () =>
      moduleSnapshot("emails", context.workspaceId, [
        ["identities", "email_identities", "user_id"],
        ["templates", "email_templates", "user_id"],
        ["logs", "email_logs", "user_id"],
      ]),
    crm: () =>
      moduleSnapshot("crm", context.workspaceId, [
        ["contacts", "contacts", "created_by"],
        ["deals", "deals", "user_id"],
        ["openTasks", "tasks", "user_id", "status IN ('open', 'in_progress')"],
        [
          "stalledDeals",
          "deals",
          "user_id",
          "updated_at < NOW() - INTERVAL '14 days'",
        ],
      ]),
    analytics: () => listAnalytics(context.workspaceId, 30),
    orders: () => getOrdersSummary(context.workspaceId, 30),
    payments: async () => ({
      providerConnected: await hasConnectedPaymentProviderServer(context.workspaceId),
      products: await listPaymentProductsServer(context.workspaceId),
    }),
  };

  const entries = await Promise.all(
    Object.entries(readers).map(async ([module, reader]) => {
      if (!(await readable(module))) return null;
      try {
        return [module, await reader()] as const;
      } catch {
        return [module, { unavailable: true }] as const;
      }
    }),
  );

  let notifications: unknown = { notifications: [], unreadCount: 0 };
  try {
    notifications = await listWorkspaceNotifications(context.workspaceId);
  } catch {
    // Notifications are helpful context, not a reason to make the whole
    // workspace snapshot unavailable on an older migration level.
  }

  return {
    scope: "workspace",
    generatedAt: new Date().toISOString(),
    modules: Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, unknown] => Boolean(entry),
      ),
    ),
    notifications,
    omittedModules: Object.keys(readers).filter((module) => {
      const setting = settings.find((entry) => entry.module === module);
      return setting?.dashboardAllowed === false || setting?.accessEnabled === false;
    }),
  };
};

/* -------------------------------------------------------------------------- */
/* The registry                                                               */
/* -------------------------------------------------------------------------- */

export const AI_TOOLS: AiTool[] = [
  {
    name: "get_workspace_snapshot",
    description:
      "Read a fresh, permission-filtered snapshot of the entire workspace, including Forms, Events, Appointments, CRM, Campaigns, Workflows, Files, Documents, Email, Orders, Payments, Analytics and current notifications. Use this first for broad questions such as what is happening, what needs attention, or which modules are active. It never includes modules this person cannot access.",
    module: "home",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) => workspaceSnapshot(context),
  },
  {
    name: "create_form",
    description:
      "Create a new draft form in this workspace from a title, description, and requested fields. Use this when the person explicitly asks you to create or build a form. The draft is created only after they approve the preview; it is never published automatically.",
    module: "forms",
    consequential: true,
    preview: (input) => {
      const title = text(input.title, 255) || "Untitled form";
      const fields = Array.isArray(input.fields) ? input.fields.length : 0;
      return `Create the draft form "${title}"${fields ? ` with ${fields} field${fields === 1 ? "" : "s"}` : ""}. It will remain unpublished.`;
    },
    inputSchema: objectSchema(
      {
        title: { type: "string", description: "The form title." },
        description: { type: "string", description: "What the form is for." },
        fields: {
          type: "array",
          items: formFieldSchema,
          description: "Fields to include in the draft, in display order.",
        },
      },
      ["title"],
    ),
    run: (input, context) => createFormForAssistant(input, context),
  },
  {
    name: "create_event",
    description:
      "Create a new draft event in this workspace with its registration form, title, schedule details, timezone, capacity, and optional ticketing. Use this only when the person explicitly asks to create an event. It remains a draft and is never published or sent to attendees automatically.",
    module: "events",
    consequential: true,
    preview: (input) =>
      `Create the draft event "${text(input.title, 255) || "Untitled event"}". It will remain unpublished until it is reviewed in Events.`,
    inputSchema: objectSchema(
      {
        title: { type: "string", description: "The event title." },
        description: { type: "string", description: "Event description." },
        eventDate: { type: "string", description: "Date in YYYY-MM-DD format." },
        startTime: { type: "string", description: "Local start time." },
        endTime: { type: "string", description: "Local end time." },
        timezone: {
          type: "string",
          description: "IANA timezone, such as Africa/Lagos.",
        },
        currency: { type: "string", description: "Three-letter currency code." },
        capacity: { type: "integer", description: "Optional attendee capacity." },
        ticketingEnabled: {
          type: "boolean",
          description: "Whether ticketing should be enabled.",
        },
      },
      ["title"],
    ),
    run: (input, context) => createEventForAssistant(input, context),
  },
  {
    name: "create_booking_page",
    description:
      "Create a new draft booking page in this workspace for Appointments. Use this when the person asks to create a booking or appointment page. It remains a draft, does not publish a link, and does not book a real appointment by itself.",
    module: "appointments",
    consequential: true,
    preview: (input) =>
      `Create the draft booking page "${text(input.name, 160) || "Untitled booking page"}". It will remain a draft.`,
    inputSchema: objectSchema(
      {
        name: { type: "string", description: "The booking page name." },
        description: {
          type: "string",
          description: "What the appointment is for.",
        },
        durationMinutes: {
          type: "integer",
          description: "Meeting duration, from 5 to 1440 minutes.",
        },
        locationType: {
          type: "string",
          enum: ["video", "phone", "in_person", "ask_invitee"],
        },
        locationDetail: {
          type: "string",
          description: "Video link, phone number, or address.",
        },
        schedulingType: {
          type: "string",
          enum: ["single", "round_robin", "collective", "group"],
        },
        capacity: { type: "integer", description: "Maximum invitees per slot." },
        priceCents: {
          type: "integer",
          description: "Optional price in the smallest currency unit.",
        },
        currency: { type: "string", description: "Three-letter currency code." },
      },
      ["name"],
    ),
    run: (input, context) => createBookingPageForAssistant(input, context),
  },
  {
    name: "create_appointment",
    description:
      "Create a real appointment in this workspace for a named invitee at the requested start and end time. Use this only when the person explicitly asks to book or schedule an appointment. It requires approval and may send the normal appointment notification email after approval.",
    module: "appointments",
    consequential: true,
    preview: (input) => {
      const invitee = text(input.inviteeName, 200) || text(input.inviteeEmail, 320) || "the invitee";
      const start = text(input.startsAt, 40) || "the requested start time";
      return `Create an appointment for ${invitee} at ${start}. The normal appointment notification may be sent after approval.`;
    },
    inputSchema: objectSchema(
      {
        bookingPageId: { type: "string", description: "Optional booking page id in this workspace." },
        routingFormId: { type: "string", description: "Optional routing form id in this workspace." },
        inviteeName: { type: "string", description: "Invitee name." },
        inviteeEmail: { type: "string", description: "Invitee email address." },
        inviteeTimezone: { type: "string", description: "IANA timezone for the invitee." },
        hostName: { type: "string", description: "Host name." },
        hostEmail: { type: "string", description: "Host email address." },
        startsAt: { type: "string", description: "Appointment start timestamp." },
        endsAt: { type: "string", description: "Appointment end timestamp." },
        locationType: {
          type: "string",
          enum: ["video", "phone", "in_person", "ask_invitee"],
        },
        meetingUrl: { type: "string", description: "Optional meeting URL." },
        answers: { type: "object", description: "Optional routing answers." },
        currency: { type: "string", description: "Three-letter currency code." },
        amountCents: { type: "integer", description: "Optional amount in the smallest currency unit." },
      },
      ["startsAt", "endsAt"],
    ),
    run: (input, context) => createAppointmentForAssistant(input, context),
  },
  {
    name: "get_forms_overview",
    description:
      "Read a compact Forms workspace snapshot: how many forms exist, how many are published, and how many workflows are attached. Use this before suggesting form changes or explaining form activity.",
    module: "forms",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) =>
      moduleSnapshot("forms", context.workspaceId, [
        ["forms", "forms", "created_by"],
        ["publishedForms", "forms", "created_by", "status = 'published'"],
        ["workflows", "workflows", "created_by"],
      ]),
  },
  {
    name: "get_events_overview",
    description:
      "Read a compact Events workspace snapshot: total events, live events, and upcoming events. Use this when the person asks about event setup, ticketing context, or sales activity.",
    module: "events",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) =>
      moduleSnapshot("events", context.workspaceId, [
        ["events", "events", "created_by"],
        [
          "liveEvents",
          "events",
          "created_by",
          "status IN ('published', 'on_sale', 'sold_out')",
        ],
        ["upcomingEvents", "events", "created_by", "starts_at >= NOW()"],
      ]),
  },
  {
    name: "get_appointments_overview",
    description:
      "Read a compact Appointments workspace snapshot: booking pages, upcoming bookings, and no-shows. Use this to analyze booking patterns or propose routing-form changes.",
    module: "appointments",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) =>
      moduleSnapshot("appointments", context.workspaceId, [
        ["bookingPages", "booking_pages", "user_id"],
        ["upcomingBookings", "appointments", "user_id", "starts_at >= NOW()"],
        ["noShows", "appointments", "user_id", "status = 'no_show'"],
      ]),
  },
  {
    name: "get_campaigns_overview",
    description:
      "Read a compact Campaigns workspace snapshot: total campaigns, active sends, and sent campaigns. Use this before drafting campaign content or explaining campaign performance.",
    module: "campaigns",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) =>
      moduleSnapshot("campaigns", context.workspaceId, [
        ["campaigns", "contact_campaigns", "user_id"],
        [
          "activeCampaigns",
          "contact_campaigns",
          "user_id",
          "status IN ('scheduled', 'sending')",
        ],
        ["sentCampaigns", "contact_campaigns", "user_id", "status = 'sent'"],
      ]),
  },
  {
    name: "get_workflows_overview",
    description:
      "Read a compact Workflow workspace snapshot: total workflows and enabled workflows. Use this when suggesting the next automation node or troubleshooting an automation.",
    module: "workflows",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) =>
      moduleSnapshot("workflows", context.workspaceId, [
        ["workflows", "workspace_workflows", "workspace_id"],
        ["enabledWorkflows", "workspace_workflows", "workspace_id", "enabled = TRUE"],
        ["formAutomations", "workflows", "created_by"],
      ]),
  },
  {
    name: "get_documents_overview",
    description:
      "Read a compact Documents workspace snapshot: templates and documents by signature status. Use this before drafting a contract or explaining a signer follow-up.",
    module: "documents",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) =>
      moduleSnapshot("documents", context.workspaceId, [
        ["templates", "document_templates", "user_id"],
        ["documents", "workspace_documents", "user_id"],
        [
          "awaitingSignature",
          "workspace_documents",
          "user_id",
          "status IN ('sent', 'viewed', 'partially_signed')",
        ],
      ]),
  },
  {
    name: "get_files_overview",
    description:
      "Read a compact Files workspace snapshot: visible files and files uploaded from forms or events. Use this when helping find a file by description or source.",
    module: "files",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) =>
      moduleSnapshot("files", context.workspaceId, [
        ["files", "workspace_files", "user_id", "deleted_at IS NULL"],
        [
          "formUploads",
          "workspace_files",
          "user_id",
          "source_type = 'form_upload' AND deleted_at IS NULL",
        ],
        [
          "eventUploads",
          "workspace_files",
          "user_id",
          "source_type = 'event_upload' AND deleted_at IS NULL",
        ],
      ]),
  },
  {
    name: "get_integrations_overview",
    description:
      "Read a compact Integrations workspace snapshot: connected, reconnect-required, and errored connections. Use this when the person asks what is connected or why a module cannot reach an external service.",
    module: "integrations",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) =>
      moduleSnapshot("integrations", context.workspaceId, [
        ["connections", "integration_connections", "workspace_id"],
        [
          "connected",
          "integration_connections",
          "workspace_id",
          "status = 'connected' AND enabled = TRUE",
        ],
        [
          "needsAttention",
          "integration_connections",
          "workspace_id",
          "status IN ('error', 'reconnect_required', 'expired')",
        ],
      ]),
  },
  {
    name: "get_email_overview",
    description:
      "Read a compact Email workspace snapshot: sender identities, templates, and recent email logs. Use this before diagnosing deliverability or drafting a reusable email template.",
    module: "emails",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) =>
      moduleSnapshot("emails", context.workspaceId, [
        ["identities", "email_identities", "user_id"],
        ["templates", "email_templates", "user_id"],
        ["logs", "email_logs", "user_id"],
      ]),
  },
  {
    name: "get_crm_pipeline_overview",
    description:
      "Read a compact CRM snapshot: contacts, deals, open tasks, and stalled deals with no recent update. Use this for lead reviews, pipeline questions, or next-step suggestions.",
    module: "crm",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) =>
      moduleSnapshot("crm", context.workspaceId, [
        ["contacts", "contacts", "created_by"],
        ["deals", "deals", "user_id"],
        ["openTasks", "tasks", "user_id", "status IN ('open', 'in_progress')"],
        [
          "stalledDeals",
          "deals",
          "user_id",
          "updated_at < NOW() - INTERVAL '14 days'",
        ],
      ]),
  },
  {
    name: "get_workspace_analytics",
    description:
      "Read the workspace's response, conversion and revenue analytics over a recent window. Call this when the person asks how the workspace is performing, how many responses or conversions there have been, or which forms are doing best.",
    module: "analytics",
    consequential: false,
    inputSchema: objectSchema({
      days: {
        type: "integer",
        description: "Size of the window in days, 1 to 365. Defaults to 30.",
      },
    }),
    run: (input, context) =>
      listAnalytics(context.workspaceId, boundedNumber(input.days, 30, 1, 365)),
  },
  {
    name: "search_contacts",
    description:
      "Find contacts in the CRM by name, email or lifecycle stage. Call this when the person refers to a contact without giving an id, or asks who is in a segment.",
    module: "crm",
    consequential: false,
    inputSchema: objectSchema({
      search: { type: "string", description: "Name or email fragment to match." },
      lifecycle: {
        type: "string",
        description: "Lifecycle stage filter, e.g. lead, customer.",
      },
      limit: { type: "integer", description: "Maximum contacts to return, 1 to 50." },
    }),
    run: (input, context) =>
      listContacts(context.workspaceId, {
        search: text(input.search, 160),
        lifecycle: text(input.lifecycle, 40),
        limit: boundedNumber(input.limit, 20, 1, 50),
      }),
  },
  {
    name: "get_contact_summary",
    description:
      "Read one contact together with their activity history and notes. Call this to summarise a relationship, or before drafting anything addressed to that person.",
    module: "crm",
    consequential: false,
    inputSchema: objectSchema(
      {
        contactId: { type: "string", description: "The contact's id." },
      },
      ["contactId"],
    ),
    run: async (input, context) => {
      const contactId = requiredId(input.contactId, "contactId");
      const [contact, activity, notes] = await Promise.all([
        getContact(context.workspaceId, contactId),
        listContactActivity(context.workspaceId, contactId),
        listContactNotes(context.workspaceId, contactId),
      ]);
      if (!contact) throw new AiToolError("That contact could not be found.", 404);
      return { contact, activity, notes };
    },
  },
  {
    name: "list_orders",
    description:
      "List the workspace's orders, optionally filtered by status, source or date range. Call this when the person asks about sales, a specific customer's purchases, or failed and refunded orders.",
    module: "orders",
    consequential: false,
    inputSchema: objectSchema({
      search: { type: "string", description: "Customer name, email or order reference." },
      status: { type: "string", description: "Order status filter." },
      source: { type: "string", description: "Where the order came from." },
      from: { type: "string", description: "Start of the range, ISO date." },
      to: { type: "string", description: "End of the range, ISO date." },
      pageSize: { type: "integer", description: "Rows to return, 1 to 50." },
    }),
    run: (input, context) =>
      listOrders(context.workspaceId, {
        search: text(input.search, 160),
        status: text(input.status, 40),
        source: text(input.source, 40),
        from: text(input.from, 40),
        to: text(input.to, 40),
        page: 1,
        pageSize: boundedNumber(input.pageSize, 20, 1, 50),
      }),
  },
  {
    name: "get_order",
    description:
      "Read one order in full, including its payment attempts and their failure reasons. Call this to answer why a specific transaction failed or what a customer was charged.",
    module: "orders",
    consequential: false,
    inputSchema: objectSchema(
      { orderId: { type: "string", description: "The order's id." } },
      ["orderId"],
    ),
    run: (input, context) =>
      getOrderDetail(context.workspaceId, requiredId(input.orderId, "orderId")),
  },
  {
    name: "get_revenue_summary",
    description:
      "Read totalled revenue, order counts and top products over a recent window. Call this for 'how much did we make' style questions rather than listing orders and adding them up.",
    module: "orders",
    consequential: false,
    inputSchema: objectSchema({
      days: { type: "integer", description: "Window in days, 1 to 365. Defaults to 30." },
    }),
    run: (input, context) =>
      getOrdersSummary(context.workspaceId, boundedNumber(input.days, 30, 1, 365)),
  },
  {
    name: "get_payment_setup",
    description:
      "Check whether a payment provider is connected and list the workspace's active products and prices. Call this before suggesting anything that requires taking payment, so the answer reflects what is actually configured.",
    module: "payments",
    consequential: false,
    inputSchema: objectSchema({}),
    run: async (_input, context) => {
      const [connected, products] = await Promise.all([
        hasConnectedPaymentProviderServer(context.workspaceId),
        listPaymentProductsServer(context.workspaceId),
      ]);
      return { providerConnected: connected, products };
    },
  },
  {
    name: "list_notifications",
    description:
      "Read the workspace's current notifications, including unread counts. Call this when the person asks what needs their attention or what they have missed.",
    module: "home",
    consequential: false,
    inputSchema: objectSchema({}),
    run: (_input, context) => listWorkspaceNotifications(context.workspaceId),
  },
  {
    name: "add_contact_note",
    description:
      "Write an internal note onto a contact's record. Notes are visible to teammates and are not sent to the contact.",
    module: "crm",
    // Internal, reversible, and never leaves the workspace, so it runs like
    // any other UI action rather than through the confirmation gate.
    consequential: false,
    inputSchema: objectSchema(
      {
        contactId: { type: "string", description: "The contact's id." },
        body: { type: "string", description: "The note text." },
      },
      ["contactId", "body"],
    ),
    run: (input, context) =>
      createContactNote(
        context.workspaceId,
        requiredId(input.contactId, "contactId"),
        requiredText(input.body, "body", 4_000),
      ),
  },
  {
    name: "send_email",
    description:
      "Send a one-off email from the workspace's sending identity. This reaches a real person's inbox, so it is always previewed and requires explicit approval before it goes out.",
    module: "emails",
    consequential: true,
    preview: (input) =>
      `Send an email to ${text(input.to, 254) || "an unnamed recipient"} with the subject "${
        text(input.subject, 200) || "(no subject)"
      }".`,
    inputSchema: objectSchema(
      {
        to: { type: "string", description: "Recipient email address." },
        subject: { type: "string", description: "Subject line." },
        body: {
          type: "string",
          description: "Message body as plain text. Written for a human to read.",
        },
      },
      ["to", "subject", "body"],
    ),
    run: async (input, context) => {
      const to = emailAddress(input.to);
      const subject = requiredText(input.subject, "subject", 200);
      const body = requiredText(input.body, "body", 20_000);
      const result = await sendEmailNow({
        userId: context.workspaceId,
        to,
        emailClassification: "TRANSACTIONAL",
        override: {
          module: "ai-assistant",
          subject,
          text: body,
          html: body
            .split(/\n{2,}/)
            .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
            .join("\n"),
        },
      });
      return { sent: true, to, subject, result };
    },
  },
];

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br />");

const toolsByName = new Map(AI_TOOLS.map((tool) => [tool.name, tool]));

/* -------------------------------------------------------------------------- */
/* Permission gate                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Whether this person may use this tool right now.
 *
 * Module access is the whole gate, deliberately: it is exactly what decides
 * whether they could perform the same action by clicking through the UI. A
 * suspended or blocked membership can use nothing at all.
 */
export const canUseTool = async (
  tool: AiTool,
  context: WorkspaceContext,
  settings?: AiModuleAccessSetting[],
) => {
  if (context.suspended || context.blocked) return false;
  if (!(await canOpenModule(context.userId, tool.module))) return false;
  return aiModuleAccessEnabled(context, tool.module, settings);
};

/** The tools offered to the model this turn. Never the full registry. */
export const toolsFor = async (context: WorkspaceContext) => {
  if (context.suspended || context.blocked) return [];
  const settings = await aiModuleAccessFor(context);
  // Module checks share the short-lived workspace-context cache. Resolve them
  // together so a chat turn does not wait on one permission check per tool.
  const allowed = await Promise.all(
    AI_TOOLS.map(async (tool) =>
      (await canUseTool(tool, context, settings)) ? tool : null,
    ),
  );
  return allowed.filter((tool): tool is AiTool => tool !== null);
};

export const toolDefinitions = (tools: AiTool[]): AiToolDefinition[] =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

export const findTool = (name: string) => toolsByName.get(name) || null;

export type AiToolOutcome =
  | { status: "ran"; result: unknown }
  | { status: "needs_confirmation"; summary: string }
  | { status: "denied"; message: string };

/**
 * Runs a tool the model asked for.
 *
 * The permission check happens here, not only when the list was built: a model
 * naming a tool it was never offered is denied the same as a browser posting
 * to an endpoint it cannot see.
 */
export const runTool = async (
  name: string,
  input: Record<string, unknown>,
  context: WorkspaceContext,
  options: { approved?: boolean } = {},
): Promise<AiToolOutcome> => {
  const tool = findTool(name);
  if (!tool) {
    return { status: "denied", message: `There is no tool named ${name}.` };
  }
  if (!(await canUseTool(tool, context))) {
    return {
      status: "denied",
      message: `You do not have access to ${tool.module} in this workspace, so this cannot be done.`,
    };
  }
  if (tool.consequential && options.approved !== true) {
    return {
      status: "needs_confirmation",
      summary: tool.preview ? tool.preview(input) : `Run ${tool.name}.`,
    };
  }
  try {
    return { status: "ran", result: await tool.run(input, context) };
  } catch (error) {
    if (error instanceof AiToolError) {
      return { status: "denied", message: error.message };
    }
    // Module errors carry user-safe messages by convention across this server.
    const message = (error as Error)?.message || "";
    return {
      status: "denied",
      message: message.slice(0, 300) || "That could not be completed.",
    };
  }
};

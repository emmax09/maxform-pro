import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import { describeSendDuration } from "./campaign-batching";
import {
  dispatchFirstCampaignBatch,
  getCampaignSendProgress,
  pauseCampaignBatches,
  planCampaignSend,
  previewCampaignPacing,
  resumeCampaignBatches,
} from "./campaign-dispatch";
import { enqueueCampaignOrchestratorJob } from "./campaign-queue";
import {
  managedSenderEmail,
  normalizeManagedSenderPrefix,
} from "./email-sender-identity";
import {
  kickCampaignAnalyticsWorker,
  recordCampaignEvent,
} from "./campaign-analytics-engine";
import { campaignSendAllowed } from "./campaign-tracking";
import { getWorkspaceEmailDeliveryState } from "./workspace-email";

/**
 * Server-side Contacts data layer.
 *
 * Every query runs here against DATABASE_URL, which never reaches the browser.
 * The workspace id always comes from the verified session token rather than
 * from the request body, so a client cannot read another workspace's records.
 */

class DataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "contacts_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new DataError(
      "This workspace is temporarily unavailable.",
      503,
      "contacts_unavailable",
    );
  }
  return neon(url);
};

type QueryResult<Row> = { rows: Row[]; rowCount: number };

const query = async <Row = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<Row>> => {
  const rows = (await database().query(text, params)) as Row[];
  return { rows, rowCount: rows.length };
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new DataError(
      "This workspace is temporarily unavailable.",
      503,
      "contacts_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const isUuidValue = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const json = (
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Vary", "Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    throw new DataError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
  try {
    const { payload } = await jwtVerify(token, signingSecret(), {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
    const userId = String(payload.userId || "");
    if (!isUuidValue(userId)) throw new Error("Invalid user");
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw new DataError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 6_000_000) {
      throw new DataError("This request is too large.", 413);
    }
  }
  if (!body) return {} as Record<string, unknown>;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid request");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new DataError("This request could not be read.", 400);
  }
};

import type {
  FormField,
  FormRecord,
} from "../src/components/forms/form-types";
import { workspaceScopeFor } from "./workspace-access";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";

type DatabaseRow = Record<string, unknown>;

const listSecureContactPayments = async (
  userId: string,
  contactEmail: string,
) => {
  const email = String(contactEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return [] as DatabaseRow[];
  }
  const result = await query<DatabaseRow>(
    `SELECT payment_order.id, payment_order.total_amount AS amount,
            payment_order.currency, payment_order.status,
            COALESCE(payment_order.paid_at, payment_order.created_at)
              AS created_at,
            COALESCE(
              form.title,
              event.title,
              invoice.invoice_number,
              payment_order.order_number
            ) AS form_title
     FROM payment_orders payment_order
     LEFT JOIN forms form
       ON payment_order.source_type = 'form'
      AND form.id = payment_order.source_id
     LEFT JOIN events event
       ON payment_order.source_type = 'event'
      AND event.id = payment_order.source_id
     LEFT JOIN payment_invoices invoice
       ON payment_order.source_type = 'invoice'
      AND invoice.id = payment_order.source_id
     WHERE payment_order.user_id = $1
       AND LOWER(TRIM(payment_order.customer_email)) = $2
       AND payment_order.status IN ('paid', 'partially_refunded', 'refunded')
     ORDER BY COALESCE(payment_order.paid_at, payment_order.created_at) DESC`,
    [userId, email],
  );
  return result.rows;
};


const asString = (value: unknown) =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const validEmailAddress = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const managedSenderForCampaign = (row: DatabaseRow) => {
  const mode = asString(row.sending_mode) === "custom" ? "custom" : "managed";
  if (mode === "custom") return asString(row.custom_sender_email || row.sender_email).trim().toLowerCase();
  const generated = asString(row.generated_sender_email).trim().toLowerCase();
  if (validEmailAddress(generated)) return generated;
  const prefix = asString(row.sender_prefix).trim().toLowerCase() || normalizeManagedSenderPrefix(row.sender_name) || "maxform";
  const domain = asString(process.env.MAXFORM_MANAGED_SENDING_DOMAIN).trim().toLowerCase() || asString(row.managed_domain).trim().toLowerCase();
  const stored = managedSenderEmail(prefix, domain);
  if (validEmailAddress(stored)) return stored;
  return "";
};

const asNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const asBoolean = (value: unknown) =>
  value === true || value === "true" || value === 1;

const emitCampaignLifecycleEvent = (
  workspaceId: string,
  campaignId: string,
  eventType: "campaign_created" | "campaign_scheduled" | "campaign_queued",
  eventKey: string,
  metadata: Record<string, unknown> = {},
) => {
  void recordCampaignEvent({
    workspaceId,
    campaignId,
    eventType,
    source: "system",
    eventKey,
    metadata,
  })
    .then(() => kickCampaignAnalyticsWorker(campaignId))
    .catch((error) => {
      console.error("[campaigns] lifecycle event failed", {
        type: error instanceof Error ? error.name : typeof error,
      });
    });
};

const asJson = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return typeof value === "object" ? (value as T) : fallback;
};

const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.map((entry) => asString(entry).trim().toLowerCase()).filter(Boolean)
    : [];

export type ContactLifecycle =
  | "lead"
  | "contacted"
  | "customer"
  | "past_customer"
  | string;

export type ContactRecord = {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  company: string;
  tags: string[];
  customFields: Record<string, unknown>;
  lifecycleStage: ContactLifecycle;
  unsubscribedAt: string | null;
  lastActivityAt: string;
  sourceType: string;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
  listIds: string[];
  listNames: string[];
};

export type ContactListRecord = {
  id: string;
  name: string;
  description: string;
  listType: "static" | "dynamic";
  filterDefinition: ContactSegmentRule[];
  memberCount: number;
  /** Contacts that can actually receive a campaign right now. */
  deliverableMemberCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type ContactSegmentRule = {
  field: "lifecycle_stage" | "tag" | "company" | "email";
  operator: "equals" | "contains" | "not_equals";
  value: string;
};

export type ContactActivityRecord = {
  id: string;
  activityType: string;
  title: string;
  detail: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ContactNoteRecord = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type ContactCustomField = {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: "text" | "number" | "date" | "select" | "checkbox";
  options: string[];
  formMappable: boolean;
  createdAt: string;
};

export type FormListMapping = {
  id: string;
  formId: string;
  listId: string;
  listName: string;
  matchMode: "email" | "email_phone";
  fieldMapping: Record<string, string>;
  addedCount: number;
};

export type ContactCampaignStatus =
  | "draft"
  | "validating"
  | "scheduled"
  | "queued"
  | "sending"
  | "sent"
  | "completed"
  | "failed"
  | "paused"
  | "cancelled"
  | "archived";

export type ContactCampaignSendStrategy =
  | "immediate"
  | "scheduled"
  | "timezone_optimized"
  | "recurring";

export type CampaignAudienceMode = "lists" | "custom";

export type ContactCampaign = {
  id: string;
  name: string;
  listId: string;
  listName: string;
  listIds: string[];
  audienceMode: CampaignAudienceMode;
  customRecipients: string[];
  excludeListId: string | null;
  excludeListName: string;
  subject: string;
  previewText: string;
  htmlBody: string;
  blocks: unknown[];
  category: string;
  status: ContactCampaignStatus;
  sendStrategy: ContactCampaignSendStrategy;
  recurrenceRule: string;
  recurrenceRequiresReview: boolean;
  scheduledAt: string | null;
  /** First durable batch dispatch, when this campaign has actually started. */
  sendStartedAt?: string | null;
  sentAt: string | null;
  archivedAt: string | null;
  spamScore: number | null;
  revenueAttributed: number;
  revenueCurrency: string;
  aiGenerated: boolean;
  identityId: string | null;
  stats: Record<string, number>;
  createdAt: string;
  updatedAt: string;
};

export type ContactCampaignSettings = {
  identityId: string | null;
  mailingAddress: string;
  footerText: string;
  brandVoice: "friendly" | "direct" | "playful" | "formal";
  /** Null keeps the safe pacing derived from the connected provider's limits. */
  batchSize: number | null;
  batchDelaySeconds: number | null;
};

export type CampaignSuppressionReason =
  | "unsubscribe"
  | "bounce"
  | "complaint"
  | "manual";

export type CampaignSuppressionRecord = {
  id: string;
  recipient: string;
  reason: CampaignSuppressionReason;
  reasonDetail: string;
  createdAt: string;
  contactId: string | null;
  contactName: string;
  sourceCampaignId: string | null;
  sourceCampaignName: string;
};

export type CampaignSuppressionPage = {
  rows: CampaignSuppressionRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  counts: Record<CampaignSuppressionReason | "all", number>;
};

export type CampaignAudiencePreview = {
  audienceMode: CampaignAudienceMode;
  listId: string;
  listName: string;
  listIds: string[];
  listNames: string[];
  customRecipientCount: number;
  excludeListId: string | null;
  excludeListName: string;
  totalInList: number;
  excluded: number;
  unsubscribed: number;
  suppressed: number;
  missingEmail: number;
  deliverable: number;
  /** Custom addresses blocked by an unsubscribe or suppression record. */
  blockedRecipients: string[];
  /** A few of the real people this would go to, for sanity-checking the pick. */
  sample: Array<{ id: string; name: string; email: string }>;
};

export type CampaignVariant = {
  id: string;
  label: "A" | "B";
  subject: string;
  previewText: string;
  blocks: unknown[];
  testPercentage: number;
  decisionMetric: "open" | "click";
  decisionAfterHours: number;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  winner: boolean;
};

export type ContactCrmSettings = {
  deduplicationMode: "email" | "email_phone";
  lifecycleStages: string[];
  unsubscribeFooter: string;
};

export const contactMatchesSegment = (
  contact: ContactRecord,
  rules: ContactSegmentRule[],
) =>
  rules.every((rule) => {
    const actual =
      rule.field === "lifecycle_stage"
        ? contact.lifecycleStage
        : rule.field === "tag"
          ? contact.tags.join(", ")
          : rule.field === "company"
            ? contact.company
            : contact.email;
    if (rule.operator === "equals") {
      return actual.toLowerCase() === rule.value.toLowerCase();
    }
    if (rule.operator === "not_equals") {
      return actual.toLowerCase() !== rule.value.toLowerCase();
    }
    return actual.toLowerCase().includes(rule.value.toLowerCase());
  });

export const contactsForList = (
  contacts: ContactRecord[],
  list: ContactListRecord,
) =>
  contacts.filter((contact) =>
    list.listType === "dynamic"
      ? contactMatchesSegment(contact, list.filterDefinition)
      : contact.listIds.includes(list.id),
  );

const mapContact = (row: DatabaseRow): ContactRecord => ({
  id: asString(row.id),
  email: asString(row.email),
  fullName: asString(row.full_name),
  phone: asString(row.phone),
  company: asString(row.company),
  tags: asJson<string[]>(row.tags, []).map(String),
  customFields: asJson<Record<string, unknown>>(row.custom_fields, {}),
  lifecycleStage: asString(row.lifecycle_stage) || "lead",
  unsubscribedAt: asString(row.unsubscribed_at) || null,
  lastActivityAt: asString(row.last_activity_at || row.updated_at),
  sourceType: asString(row.source_type) || "manual",
  sourceId: asString(row.source_id) || null,
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
  listIds: asJson<string[]>(row.list_ids, []).map(String),
  listNames: asJson<string[]>(row.list_names, []).map(String),
});

const mapList = (row: DatabaseRow): ContactListRecord => ({
  id: asString(row.id),
  name: asString(row.name),
  description: asString(row.description),
  listType: row.list_type === "dynamic" ? "dynamic" : "static",
  filterDefinition: asJson<ContactSegmentRule[]>(row.filter_definition, []),
  memberCount: asNumber(row.member_count),
  deliverableMemberCount: asNumber(
    row.deliverable_member_count ?? row.member_count,
  ),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
});

export async function listContacts(
  userId: string,
  options: {
    search?: string;
    lifecycle?: string;
    listId?: string;
    limit?: number;
  } = {},
) {
  const search = options.search?.trim() || "";
  const lifecycle = options.lifecycle?.trim() || "";
  const listId = options.listId?.trim() || null;
  const result = await query(
    `SELECT contact.*,
       COALESCE(
         jsonb_agg(DISTINCT list.id) FILTER (WHERE list.id IS NOT NULL),
         '[]'::jsonb
       ) AS list_ids,
       COALESCE(
         jsonb_agg(DISTINCT list.name) FILTER (WHERE list.id IS NOT NULL),
         '[]'::jsonb
       ) AS list_names
     FROM contacts contact
     LEFT JOIN contact_list_members member ON member.contact_id = contact.id
     LEFT JOIN contact_lists list ON list.id = member.list_id
     WHERE contact.created_by = $1
       AND (
         $2 = '' OR
         contact.full_name ILIKE '%' || $2 || '%' OR
         contact.email ILIKE '%' || $2 || '%' OR
         contact.phone ILIKE '%' || $2 || '%' OR
         contact.company ILIKE '%' || $2 || '%'
       )
       AND ($3 = '' OR contact.lifecycle_stage = $3)
       AND (
         $4::uuid IS NULL OR
         EXISTS (
           SELECT 1
           FROM contact_list_members selected_member
           WHERE selected_member.contact_id = contact.id
             AND selected_member.list_id = $4::uuid
         )
       )
     GROUP BY contact.id
     ORDER BY contact.last_activity_at DESC, contact.created_at DESC
     LIMIT $5`,
    [userId, search, lifecycle, listId, options.limit || 500],
  );
  return result.rows.map((row) => mapContact(row as DatabaseRow));
}

export async function getContact(userId: string, contactId: string) {
  const result = await query(
    `SELECT contact.*,
       COALESCE(
         jsonb_agg(DISTINCT list.id) FILTER (WHERE list.id IS NOT NULL),
         '[]'::jsonb
       ) AS list_ids,
       COALESCE(
         jsonb_agg(DISTINCT list.name) FILTER (WHERE list.id IS NOT NULL),
         '[]'::jsonb
       ) AS list_names
     FROM contacts contact
     LEFT JOIN contact_list_members member ON member.contact_id = contact.id
     LEFT JOIN contact_lists list ON list.id = member.list_id
     WHERE contact.created_by = $1 AND contact.id = $2
     GROUP BY contact.id
     LIMIT 1`,
    [userId, contactId],
  );
  return result.rows[0]
    ? mapContact(result.rows[0] as DatabaseRow)
    : null;
}

export async function createContact(
  userId: string,
  input: {
    email: string;
    fullName?: string;
    phone?: string;
    company?: string;
    tags?: string[];
    lifecycleStage?: string;
    customFields?: Record<string, unknown>;
    sourceType?: string;
    sourceId?: string | null;
  },
) {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("Email is required");
  try {
    const result = await query(
      `INSERT INTO contacts (
         email, full_name, phone, company, tags, custom_fields, created_by,
         lifecycle_stage, source_type, source_id, last_activity_at,
         created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10,
         NOW(), NOW(), NOW()
       )
       RETURNING *`,
      [
        email,
        input.fullName?.trim() || null,
        input.phone?.trim() || null,
        input.company?.trim() || null,
        JSON.stringify(input.tags || []),
        JSON.stringify(input.customFields || {}),
        userId,
        input.lifecycleStage || "lead",
        input.sourceType || "manual",
        input.sourceId || null,
      ],
    );
    const contact = mapContact(result.rows[0] as DatabaseRow);
    await addContactActivity(userId, contact.id, {
      activityType: "contact_created",
      title: "Contact created",
      detail: input.sourceType === "form" ? "Created from a form response" : "Created manually",
    });
    if (input.sourceType !== "workflow") {
      try {
        await dispatchWorkspaceWorkflowEvent(
          userId,
          "contact_created",
          { id: contact.id, contact: contact as unknown as DatabaseRow },
          `contact_created:${contact.id}`,
        );
      } catch {
        // Workflow delivery is isolated from CRM writes.
      }
    }
    return contact;
  } catch (error) {
    if (
      error instanceof Error &&
      /unique|duplicate|idx_contacts_owner_email/i.test(error.message)
    ) {
      throw new Error("A contact with this email already exists");
    }
    throw error;
  }
}

export async function updateContact(
  userId: string,
  contactId: string,
  input: Partial<{
    email: string;
    fullName: string;
    phone: string;
    company: string;
    tags: string[];
    lifecycleStage: string;
    customFields: Record<string, unknown>;
    unsubscribed: boolean;
    sourceType?: string;
  }>,
) {
  const current = await getContact(userId, contactId);
  if (!current) throw new Error("Contact not found");
  const result = await query(
    `UPDATE contacts
     SET email = $1,
         full_name = $2,
         phone = $3,
         company = $4,
         tags = $5::jsonb,
         lifecycle_stage = $6,
         custom_fields = $7::jsonb,
         unsubscribed_at = CASE WHEN $8 THEN COALESCE(unsubscribed_at, NOW()) ELSE NULL END,
         last_activity_at = NOW(),
         updated_at = NOW()
     WHERE id = $9 AND created_by = $10
     RETURNING *`,
    [
      (input.email ?? current.email).trim().toLowerCase(),
      (input.fullName ?? current.fullName).trim() || null,
      (input.phone ?? current.phone).trim() || null,
      (input.company ?? current.company).trim() || null,
      JSON.stringify(input.tags ?? current.tags),
      input.lifecycleStage ?? current.lifecycleStage,
      JSON.stringify(input.customFields ?? current.customFields),
      input.unsubscribed ?? Boolean(current.unsubscribedAt),
      contactId,
      userId,
    ],
  );
  if (!result.rows[0]) throw new Error("Contact not found");
  await addContactActivity(userId, contactId, {
    activityType: "contact_updated",
    title: "Contact updated",
    detail: "Profile details were updated",
  });
  const contact = mapContact(result.rows[0] as DatabaseRow);
  if (input.sourceType !== "workflow") {
    try {
      await dispatchWorkspaceWorkflowEvent(
        userId,
        "contact_updated",
        { id: contact.id, contact: contact as unknown as DatabaseRow },
        `contact_updated:${contact.id}:${String(result.rows[0].updated_at || Date.now())}`,
      );
    } catch {
      // Workflow delivery is isolated from CRM writes.
    }
  }
  return contact;
}

export async function deleteContacts(userId: string, contactIds: string[]) {
  if (contactIds.length === 0) return 0;
  const result = await query(
    `DELETE FROM contacts
     WHERE created_by = $1 AND id = ANY($2::uuid[])
     RETURNING id`,
    [userId, contactIds],
  );
  return result.rowCount;
}

export async function mergeContacts(
  userId: string,
  winnerContactId: string,
  mergedContactId: string,
) {
  if (winnerContactId === mergedContactId) {
    throw new Error("Choose two different contacts");
  }
  const result = await query(
    `WITH winner AS (
       SELECT *
       FROM contacts
       WHERE id = $1 AND created_by = $3
     ),
     absorbed AS (
       SELECT *
       FROM contacts
       WHERE id = $2 AND created_by = $3
     ),
     moved_members AS (
       INSERT INTO contact_list_members (
         list_id, contact_id, source_type, source_id, added_at
       )
       SELECT member.list_id, winner.id, 'merge', absorbed.id, member.added_at
       FROM contact_list_members member
       CROSS JOIN winner
       CROSS JOIN absorbed
       WHERE member.contact_id = absorbed.id
       ON CONFLICT (list_id, contact_id) DO NOTHING
       RETURNING contact_id
     ),
     moved_activity AS (
       UPDATE contact_activity
       SET contact_id = winner.id
       FROM winner, absorbed
       WHERE contact_activity.contact_id = absorbed.id
       RETURNING contact_activity.id
     ),
     moved_notes AS (
       UPDATE contact_notes
       SET contact_id = winner.id
       FROM winner, absorbed
       WHERE contact_notes.contact_id = absorbed.id
       RETURNING contact_notes.id
     ),
     moved_timeline AS (
       UPDATE crm_timeline_events
       SET contact_id = winner.id
       FROM winner, absorbed
       WHERE crm_timeline_events.contact_id = absorbed.id
       RETURNING crm_timeline_events.id
     ),
     moved_deals AS (
       UPDATE deals
       SET contact_id = winner.id, updated_at = NOW()
       FROM winner, absorbed
       WHERE deals.contact_id = absorbed.id
       RETURNING deals.id
     ),
     moved_tasks AS (
       UPDATE tasks
       SET contact_id = winner.id, updated_at = NOW()
       FROM winner, absorbed
       WHERE tasks.contact_id = absorbed.id
       RETURNING tasks.id
     ),
     moved_orders AS (
       UPDATE payment_orders
       SET contact_id = winner.id, updated_at = NOW()
       FROM winner, absorbed
       WHERE payment_orders.contact_id = absorbed.id
       RETURNING payment_orders.id
     ),
     moved_appointments AS (
       UPDATE appointments
       SET contact_id = winner.id, updated_at = NOW()
       FROM winner, absorbed
       WHERE appointments.contact_id = absorbed.id
       RETURNING appointments.id
     ),
     moved_documents AS (
       UPDATE workspace_documents
       SET contact_id = winner.id, updated_at = NOW()
       FROM winner, absorbed
       WHERE workspace_documents.contact_id = absorbed.id
       RETURNING workspace_documents.id
     ),
     moved_campaign_messages AS (
       UPDATE contact_campaign_messages
       SET contact_id = winner.id, updated_at = NOW()
       FROM winner, absorbed
       WHERE contact_campaign_messages.contact_id = absorbed.id
       RETURNING contact_campaign_messages.id
     ),
     updated_winner AS (
       UPDATE contacts contact
       SET full_name = COALESCE(NULLIF(winner.full_name, ''), absorbed.full_name),
           phone = COALESCE(NULLIF(winner.phone, ''), absorbed.phone),
           company = COALESCE(NULLIF(winner.company, ''), absorbed.company),
           tags = COALESCE(
             (
               SELECT jsonb_agg(DISTINCT tag)
               FROM jsonb_array_elements(
                 COALESCE(winner.tags, '[]'::jsonb) ||
                 COALESCE(absorbed.tags, '[]'::jsonb)
               ) tag
             ),
             '[]'::jsonb
           ),
           custom_fields =
             COALESCE(absorbed.custom_fields, '{}'::jsonb) ||
             COALESCE(winner.custom_fields, '{}'::jsonb),
           lifecycle_stage = CASE
             WHEN winner.lifecycle_stage = 'lead'
               THEN absorbed.lifecycle_stage
             ELSE winner.lifecycle_stage
           END,
           unsubscribed_at = COALESCE(
             winner.unsubscribed_at,
             absorbed.unsubscribed_at
           ),
           last_activity_at = GREATEST(
             winner.last_activity_at,
             absorbed.last_activity_at
           ),
           updated_at = NOW()
       FROM winner, absorbed
       WHERE contact.id = winner.id
       RETURNING contact.id
     ),
     logged AS (
       INSERT INTO contact_merges (
         user_id, winner_contact_id, merged_contact_id, snapshot, merged_by,
         created_at
       )
       SELECT $3, winner.id, absorbed.id, to_jsonb(absorbed), $3, NOW()
       FROM winner, absorbed
       WHERE EXISTS (SELECT 1 FROM updated_winner)
       RETURNING id
     ),
     deleted AS (
       DELETE FROM contacts contact
       USING absorbed
       WHERE contact.id = absorbed.id
         AND EXISTS (SELECT 1 FROM updated_winner)
         AND EXISTS (SELECT 1 FROM logged)
         AND (SELECT COUNT(*) FROM moved_members) >= 0
         AND (SELECT COUNT(*) FROM moved_activity) >= 0
         AND (SELECT COUNT(*) FROM moved_notes) >= 0
         AND (SELECT COUNT(*) FROM moved_timeline) >= 0
         AND (SELECT COUNT(*) FROM moved_deals) >= 0
         AND (SELECT COUNT(*) FROM moved_tasks) >= 0
         AND (SELECT COUNT(*) FROM moved_orders) >= 0
         AND (SELECT COUNT(*) FROM moved_appointments) >= 0
         AND (SELECT COUNT(*) FROM moved_documents) >= 0
         AND (SELECT COUNT(*) FROM moved_campaign_messages) >= 0
       RETURNING contact.id
     )
     SELECT
       (SELECT id FROM updated_winner) AS winner_id,
       (SELECT id FROM deleted) AS merged_id`,
    [winnerContactId, mergedContactId, userId],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row?.winner_id || !row?.merged_id) {
    throw new Error("The contacts could not be merged");
  }
  await addContactActivity(userId, winnerContactId, {
    activityType: "contacts_merged",
    title: "Duplicate contact merged",
    detail: "Profile fields, notes, timeline entries, and list memberships were combined",
    entityType: "contact_merge",
  });
  return getContact(userId, winnerContactId);
}

export async function addContactActivity(
  userId: string,
  contactId: string,
  input: {
    activityType: string;
    title: string;
    detail?: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await query(
    `WITH owned_contact AS (
       SELECT id FROM contacts WHERE id = $1 AND created_by = $2
     ),
     inserted AS (
       INSERT INTO contact_activity (
         contact_id, user_id, activity_type, title, detail, entity_type,
         entity_id, metadata, created_at
       )
       SELECT id, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW()
       FROM owned_contact
       RETURNING id
     )
     UPDATE contacts
     SET last_activity_at = NOW()
     WHERE id IN (SELECT id FROM owned_contact)
     RETURNING id`,
    [
      contactId,
      userId,
      input.activityType,
      input.title,
      input.detail || "",
      input.entityType || null,
      input.entityId || null,
      JSON.stringify(input.metadata || {}),
    ],
  );
}

export async function listContactActivity(
  userId: string,
  contactId: string,
) {
  const result = await query(
    `SELECT activity.*
     FROM contact_activity activity
     JOIN contacts contact ON contact.id = activity.contact_id
     WHERE activity.contact_id = $1 AND contact.created_by = $2
     ORDER BY activity.created_at DESC`,
    [contactId, userId],
  );
  return result.rows.map((raw) => {
    const row = raw as DatabaseRow;
    return {
      id: asString(row.id),
      activityType: asString(row.activity_type),
      title: asString(row.title),
      detail: asString(row.detail),
      entityType: asString(row.entity_type) || null,
      entityId: asString(row.entity_id) || null,
      metadata: asJson<Record<string, unknown>>(row.metadata, {}),
      createdAt: asString(row.created_at),
    } satisfies ContactActivityRecord;
  });
}

export async function listContactNotes(userId: string, contactId: string) {
  const result = await query(
    `SELECT note.*
     FROM contact_notes note
     JOIN contacts contact ON contact.id = note.contact_id
     WHERE note.contact_id = $1 AND contact.created_by = $2
     ORDER BY note.created_at DESC`,
    [contactId, userId],
  );
  return result.rows.map((raw) => {
    const row = raw as DatabaseRow;
    return {
      id: asString(row.id),
      body: asString(row.body),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    } satisfies ContactNoteRecord;
  });
}

export async function createContactNote(
  userId: string,
  contactId: string,
  body: string,
) {
  const result = await query(
    `INSERT INTO contact_notes (
       contact_id, user_id, body, created_by, created_at, updated_at
     )
     SELECT contact.id, $1, $3, $1, NOW(), NOW()
     FROM contacts contact
     WHERE contact.id = $2 AND contact.created_by = $1
     RETURNING *`,
    [userId, contactId, body.trim()],
  );
  if (!result.rows[0]) throw new Error("Contact not found");
  await addContactActivity(userId, contactId, {
    activityType: "note_added",
    title: "Note added",
    detail: body.trim().slice(0, 160),
  });
  const row = result.rows[0] as DatabaseRow;
  return {
    id: asString(row.id),
    body: asString(row.body),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  } satisfies ContactNoteRecord;
}

export async function listContactLists(
  userId: string,
  listType?: "static" | "dynamic",
) {
  const result = await query(
    `SELECT list.*,
       COUNT(member.contact_id)::int AS member_count,
       COUNT(member.contact_id) FILTER (
         WHERE contact.id IS NOT NULL
           AND contact.unsubscribed_at IS NULL
           AND suppression.id IS NULL
           AND LENGTH(TRIM(contact.email)) > 3
       )::int AS deliverable_member_count
     FROM contact_lists list
     LEFT JOIN contact_list_members member ON member.list_id = list.id
     LEFT JOIN contacts contact
       ON contact.id = member.contact_id
      AND contact.created_by = list.user_id
     LEFT JOIN email_suppressions suppression
       ON suppression.user_id = list.user_id
      AND LOWER(TRIM(suppression.recipient)) = LOWER(TRIM(contact.email))
     WHERE list.user_id = $1
       AND ($2 = '' OR list.list_type = $2)
     GROUP BY list.id
     ORDER BY list.updated_at DESC`,
    [userId, listType || ""],
  );
  return result.rows.map((row) => mapList(row as DatabaseRow));
}

export async function saveContactList(
  userId: string,
  input: {
    id?: string;
    name: string;
    description?: string;
    listType: "static" | "dynamic";
    filterDefinition?: ContactSegmentRule[];
  },
) {
  const result = input.id
    ? await query(
        `UPDATE contact_lists
         SET name = $1, description = $2, filter_definition = $3::jsonb,
             updated_at = NOW()
         WHERE id = $4 AND user_id = $5
         RETURNING *`,
        [
          input.name.trim(),
          input.description?.trim() || "",
          JSON.stringify(input.filterDefinition || []),
          input.id,
          userId,
        ],
      )
    : await query(
        `INSERT INTO contact_lists (
           user_id, name, description, list_type, filter_definition,
           created_by, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $1, NOW(), NOW())
         RETURNING *`,
        [
          userId,
          input.name.trim(),
          input.description?.trim() || "",
          input.listType,
          JSON.stringify(input.filterDefinition || []),
        ],
      );
  if (!result.rows[0]) throw new Error("List could not be saved");
  return mapList({ ...(result.rows[0] as DatabaseRow), member_count: 0 });
}

export async function deleteContactList(userId: string, listId: string) {
  const result = await query(
    `DELETE FROM contact_lists
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [listId, userId],
  );
  return result.rowCount > 0;
}

export async function addContactsToList(
  userId: string,
  listId: string,
  contactIds: string[],
  sourceType = "manual",
  sourceId?: string,
) {
  if (contactIds.length === 0) return 0;
  const result = await query(
    `INSERT INTO contact_list_members (
       list_id, contact_id, source_type, source_id, added_at
     )
     SELECT list.id, contact.id, $4, $5, NOW()
     FROM contact_lists list
     JOIN contacts contact ON contact.created_by = list.user_id
     WHERE list.id = $1
       AND list.user_id = $2
       AND contact.id = ANY($3::uuid[])
     ON CONFLICT (list_id, contact_id) DO NOTHING
     RETURNING contact_id`,
    [listId, userId, contactIds, sourceType, sourceId || null],
  );
  // ON CONFLICT DO NOTHING means a returned row is genuinely a new member, so
  // this fires once per subscriber however many times the list is re-imported.
  // A workflow-driven add does not re-emit, or a workflow that adds someone to
  // an audience would retrigger itself.
  if (sourceType !== "workflow") {
    for (const row of result.rows as DatabaseRow[]) {
      const contactId = String((row as DatabaseRow).contact_id || "");
      if (!contactId) continue;
      try {
        await dispatchWorkspaceWorkflowEvent(
          userId,
          "subscriber_joined",
          { id: contactId, contactId, listId, sourceType },
          `subscriber_joined:${listId}:${contactId}`,
        );
      } catch {
        // Workflow delivery is isolated from CRM writes.
      }
    }
  }
  return result.rowCount;
}

export async function removeContactsFromList(
  userId: string,
  listId: string,
  contactIds: string[],
) {
  if (contactIds.length === 0) return 0;
  const result = await query(
    `DELETE FROM contact_list_members member
     USING contact_lists list, contacts contact
     WHERE member.list_id = list.id
       AND member.contact_id = contact.id
       AND list.id = $1
       AND list.user_id = $2
       AND contact.id = ANY($3::uuid[])
     RETURNING member.contact_id`,
    [listId, userId, contactIds],
  );
  return result.rowCount;
}

export async function listFormListMappings(
  userId: string,
  formId: string,
) {
  const result = await query(
    `SELECT mapping.*, list.name AS list_name,
       (
         SELECT COUNT(*)::int
         FROM contact_list_members member
         WHERE member.list_id = mapping.list_id
           AND member.source_type = 'form'
           AND member.source_id = mapping.form_id
       ) AS added_count
     FROM form_list_mappings mapping
     JOIN forms form ON form.id = mapping.form_id
     JOIN contact_lists list ON list.id = mapping.list_id
     WHERE mapping.form_id = $1
       AND form.created_by = $2
       AND list.user_id = $2
     ORDER BY list.name`,
    [formId, userId],
  );
  return result.rows.map((raw) => {
    const row = raw as DatabaseRow;
    return {
      id: asString(row.id),
      formId: asString(row.form_id),
      listId: asString(row.list_id),
      listName: asString(row.list_name),
      matchMode: row.match_mode === "email_phone" ? "email_phone" : "email",
      fieldMapping: asJson<Record<string, string>>(row.field_mapping, {}),
      addedCount: asNumber(row.added_count),
    } satisfies FormListMapping;
  });
}

export async function saveFormListMapping(
  userId: string,
  input: {
    formId: string;
    listId: string;
    matchMode: "email" | "email_phone";
    fieldMapping: Record<string, string>;
  },
) {
  const result = await query(
    `INSERT INTO form_list_mappings (
       form_id, list_id, match_mode, field_mapping, created_at, updated_at
     )
     SELECT form.id, list.id, $3, $4::jsonb, NOW(), NOW()
     FROM forms form
     JOIN contact_lists list ON list.user_id = form.created_by
     WHERE form.id = $1 AND form.created_by = $2 AND list.id = $5
     ON CONFLICT (form_id, list_id)
     DO UPDATE SET
       match_mode = EXCLUDED.match_mode,
       field_mapping = EXCLUDED.field_mapping,
       updated_at = NOW()
     RETURNING id`,
    [
      input.formId,
      userId,
      input.matchMode,
      JSON.stringify(input.fieldMapping),
      input.listId,
    ],
  );
  if (!result.rows[0]) throw new Error("Form-to-list connection could not be saved");
  return asString((result.rows[0] as DatabaseRow).id);
}

export async function deleteFormListMapping(
  userId: string,
  mappingId: string,
) {
  const result = await query(
    `DELETE FROM form_list_mappings mapping
     USING forms form
     WHERE mapping.id = $1
       AND mapping.form_id = form.id
       AND form.created_by = $2
     RETURNING mapping.id`,
    [mappingId, userId],
  );
  return result.rowCount > 0;
}

export async function listContactCustomFields(userId: string) {
  const result = await query(
    `SELECT id, field_key, label, field_type, options, form_mappable, created_at
     FROM contact_field_definitions
     WHERE user_id = $1
     ORDER BY created_at`,
    [userId],
  );
  return result.rows.map((raw) => {
    const row = raw as DatabaseRow;
    return {
      id: asString(row.id),
      fieldKey: asString(row.field_key),
      label: asString(row.label),
      fieldType: asString(row.field_type) as ContactCustomField["fieldType"],
      options: asJson<string[]>(row.options, []).map(String),
      formMappable: asBoolean(row.form_mappable),
      createdAt: asString(row.created_at),
    } satisfies ContactCustomField;
  });
}

export async function createContactCustomField(
  userId: string,
  input: Omit<ContactCustomField, "id" | "createdAt" | "fieldKey"> & {
    fieldKey?: string;
  },
) {
  const key = (input.fieldKey || input.label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  const result = await query(
    `INSERT INTO contact_field_definitions (
       user_id, field_key, label, field_type, options, form_mappable,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
     RETURNING *`,
    [
      userId,
      key,
      input.label.trim(),
      input.fieldType,
      JSON.stringify(input.options || []),
      input.formMappable,
    ],
  );
  return (await listContactCustomFields(userId)).find(
    (field) => field.id === asString((result.rows[0] as DatabaseRow).id),
  )!;
}

export async function updateContactCustomField(
  userId: string,
  fieldId: string,
  input: {
    label: string;
    fieldType: ContactCustomField["fieldType"];
    options: string[];
    formMappable: boolean;
  },
) {
  const result = await query(
    `UPDATE contact_field_definitions
     SET label = $1,
         field_type = $2,
         options = $3::jsonb,
         form_mappable = $4,
         updated_at = NOW()
     WHERE id = $5 AND user_id = $6
     RETURNING id`,
    [
      input.label.trim(),
      input.fieldType,
      JSON.stringify(input.options),
      input.formMappable,
      fieldId,
      userId,
    ],
  );
  if (!result.rows[0]) throw new Error("Custom field not found");
  return (await listContactCustomFields(userId)).find(
    (field) => field.id === fieldId,
  )!;
}

export async function deleteContactCustomField(
  userId: string,
  fieldId: string,
) {
  const result = await query(
    `DELETE FROM contact_field_definitions
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [fieldId, userId],
  );
  return result.rowCount > 0;
}

const mapCampaign = (row: DatabaseRow): ContactCampaign => {
  const listIds = normalizeCampaignListIds(
    asJson<unknown[]>(row.audience_list_ids, []),
    row.list_id,
  );
  const audienceMode: CampaignAudienceMode =
    asString(row.audience_mode) === "custom" ? "custom" : "lists";
  const customRecipients = normalizeCampaignRecipients(
    asJson<unknown[]>(row.custom_recipients, []),
  );
  return {
    id: asString(row.id),
    name: asString(row.name),
    listId: asString(row.list_id) || listIds[0] || "",
    listName:
      audienceMode === "custom"
        ? "Custom email addresses"
        : listIds.length > 1
          ? `${listIds.length} lists`
          : asString(row.list_name),
    listIds,
    audienceMode,
    customRecipients,
    excludeListId: asString(row.exclude_list_id) || null,
    excludeListName: asString(row.exclude_list_name),
    subject: asString(row.subject),
    previewText: asString(row.preview_text),
    htmlBody: asString(row.html_body),
    blocks: asJson<unknown[]>(row.blocks, []),
    category: asString(row.category) || "newsletter",
    status: asString(row.status) as ContactCampaignStatus,
    sendStrategy: (asString(row.send_strategy) ||
      "immediate") as ContactCampaignSendStrategy,
    recurrenceRule: asString(row.recurrence_rule),
    recurrenceRequiresReview: row.recurrence_requires_review == null
      ? true
      : asBoolean(row.recurrence_requires_review),
    scheduledAt: asString(row.scheduled_at) || null,
    sendStartedAt: asString(row.send_started_at) || null,
    sentAt: asString(row.sent_at) || null,
    archivedAt: asString(row.archived_at) || null,
    spamScore: row.spam_score == null ? null : asNumber(row.spam_score),
    revenueAttributed: asNumber(row.revenue_attributed),
    revenueCurrency: asString(row.revenue_currency) || "USD",
    aiGenerated: asBoolean(row.ai_generated),
    identityId: asString(row.identity_id) || null,
    stats: {
      ...asJson<Record<string, number>>(row.stats, {}),
      ...asJson<Record<string, number>>(row.live_stats, {}),
    },
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
};

const campaignSelect = `SELECT campaign.*, list.name AS list_name,
       exclude_list.name AS exclude_list_name,
       COALESCE(metric.live_stats, '{}'::jsonb) AS live_stats,
       send_state.send_started_at
     FROM contact_campaigns campaign
     LEFT JOIN contact_lists list ON list.id = campaign.list_id
     LEFT JOIN contact_lists exclude_list
       ON exclude_list.id = campaign.exclude_list_id
     LEFT JOIN (
       SELECT workspace_id, campaign_id,
              jsonb_build_object(
                'recipients', recipient_count,
                'sent', sent_count,
                'delivered', delivered_count,
                'opened', unique_open_count,
                'clicked', unique_click_count,
                'total_opens', total_open_count,
                'total_clicks', total_click_count,
                'pending', pending_count,
                'failed', failed_count,
                'bounced', bounced_count,
                'complained', complaint_count,
                'unsubscribed', unsubscribe_count
              ) AS live_stats
       FROM campaign_metrics
     ) metric
       ON metric.campaign_id = campaign.id
      AND metric.workspace_id = campaign.user_id
     LEFT JOIN (
       SELECT campaign_id, MIN(dispatched_at) AS send_started_at
       FROM campaign_send_batches
       WHERE dispatched_at IS NOT NULL
       GROUP BY campaign_id
     ) send_state ON send_state.campaign_id = campaign.id`;

const campaignSendStrategies = new Set([
  "immediate",
  "scheduled",
  "timezone_optimized",
  "recurring",
]);

/**
 * A campaign block is stored exactly as email_templates.blocks stores one, so
 * the same builder reads and writes both. Only the outer shape is validated
 * here; block-level content is the builder's concern.
 */
const campaignBlocks = (value: unknown) => {
  if (!Array.isArray(value)) return [] as unknown[];
  const blocks = value.filter(
    (block) => block && typeof block === "object" && !Array.isArray(block),
  );
  if (blocks.length > 200) {
    throw new DataError("This campaign has too many blocks to save.");
  }
  return blocks;
};

const MAX_CUSTOM_CAMPAIGN_RECIPIENTS = 10_000;
const campaignEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeCampaignListIds = (value: unknown, legacyListId?: unknown) => {
  const provided = Array.isArray(value) ? value : [];
  const candidates = [
    ...provided,
    ...(provided.length === 0 && legacyListId ? [legacyListId] : []),
  ];
  const listIds = Array.from(
    new Set(
      candidates
        .map((entry) => asString(entry).trim())
        .filter((entry) => entry && isUuidValue(entry)),
    ),
  );
  if (
    candidates.some(
      (entry) =>
        asString(entry).trim() && !isUuidValue(asString(entry).trim()),
    )
  ) {
    throw new DataError("One of the selected audience lists is not valid.");
  }
  return listIds;
};

const normalizeCampaignRecipients = (value: unknown) => {
  const entries = Array.isArray(value) ? value : [];
  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const email = asString(entry).trim().toLowerCase();
    if (!email) continue;
    if (!campaignEmailPattern.test(email)) {
      throw new DataError(`“${email.slice(0, 80)}” is not a valid email address.`);
    }
    if (seen.has(email)) continue;
    seen.add(email);
    recipients.push(email);
  }
  if (recipients.length > MAX_CUSTOM_CAMPAIGN_RECIPIENTS) {
    throw new DataError(
      `A custom audience can contain up to ${MAX_CUSTOM_CAMPAIGN_RECIPIENTS.toLocaleString()} email addresses.`,
    );
  }
  return recipients;
};

const normalizeCampaignAudience = (input: {
  audienceMode?: unknown;
  listIds?: unknown;
  listId?: unknown;
  customRecipients?: unknown;
}) => {
  const listIds = normalizeCampaignListIds(input.listIds, input.listId);
  const customRecipients = normalizeCampaignRecipients(input.customRecipients);
  const audienceMode: CampaignAudienceMode =
    input.audienceMode === "custom" ||
    (!input.audienceMode && !listIds.length && customRecipients.length)
      ? "custom"
      : "lists";
  if (audienceMode === "lists" && !listIds.length) {
    throw new DataError("Choose at least one audience list.");
  }
  if (audienceMode === "custom" && !customRecipients.length) {
    throw new DataError("Enter at least one recipient email address.");
  }
  return { audienceMode, listIds, customRecipients };
};

const requireOwnedList = async (userId: string, listId: string) => {
  const result = await query(
    `SELECT id FROM contact_lists WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [listId, userId],
  );
  if (!result.rows[0]) throw new DataError("That audience is not available.");
  return listId;
};

export async function listContactCampaigns(userId: string) {
  const result = await query(
    `${campaignSelect}
     WHERE campaign.user_id = $1
     ORDER BY campaign.updated_at DESC`,
    [userId],
  );
  return result.rows.map((raw) => mapCampaign(raw as DatabaseRow));
}

const campaignSuppressionReasons = new Set<CampaignSuppressionReason>([
  "unsubscribe",
  "bounce",
  "complaint",
  "manual",
]);

export async function listCampaignSuppressions(
  userId: string,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
    reason?: CampaignSuppressionReason | "all";
  } = {},
): Promise<CampaignSuppressionPage> {
  const requestedPageSize = Number(options.pageSize);
  const requestedPage = Number(options.page);
  const pageSize = Math.min(
    50,
    Math.max(
      1,
      Number.isFinite(requestedPageSize)
        ? Math.floor(requestedPageSize)
        : 8,
    ),
  );
  const page = Math.max(
    1,
    Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1,
  );
  const search = String(options.search || "")
    .trim()
    .slice(0, 160);
  const requestedReason = String(options.reason || "all") as
    | CampaignSuppressionReason
    | "all";
  // Read through ReadonlySet<string>: Set<Reason>.has() will not accept the
  // wider "all" | Reason, even though checking it is the whole point.
  const reason = (campaignSuppressionReasons as ReadonlySet<string>).has(
    requestedReason,
  )
    ? requestedReason
    : "all";
  const searchPattern = `%${search}%`;

  const [rowsResult, countResult, filteredCountResult] = await Promise.all([
    query(
      `SELECT suppression.id, suppression.recipient, suppression.reason,
              suppression.reason_detail, suppression.created_at,
              contact.id AS contact_id,
              COALESCE(NULLIF(TRIM(contact.full_name), ''), suppression.recipient)
                AS contact_name,
              COALESCE(source_campaign.id, inferred_campaign.id)
                AS source_campaign_id,
              COALESCE(source_campaign.name, inferred_campaign.name, '')
                AS source_campaign_name
       FROM email_suppressions suppression
       LEFT JOIN contacts contact
         ON contact.created_by = suppression.user_id
        AND LOWER(TRIM(contact.email)) = LOWER(TRIM(suppression.recipient))
       LEFT JOIN contact_campaign_messages source_message
         ON source_message.id = suppression.source_message_id
       LEFT JOIN contact_campaigns source_campaign
         ON source_campaign.id = source_message.campaign_id
        AND source_campaign.user_id = suppression.user_id
       LEFT JOIN LATERAL (
         SELECT campaign.id, campaign.name
         FROM contact_campaign_messages message
         JOIN contact_campaigns campaign
           ON campaign.id = message.campaign_id
          AND campaign.user_id = suppression.user_id
         WHERE LOWER(TRIM(message.recipient)) =
                 LOWER(TRIM(suppression.recipient))
         ORDER BY message.created_at DESC
         LIMIT 1
       ) inferred_campaign ON TRUE
       WHERE suppression.user_id = $1
         AND ($2 = '' OR suppression.reason = $2)
         AND (
           $3 = '%%'
           OR LOWER(suppression.recipient) LIKE LOWER($3)
           OR LOWER(COALESCE(contact.full_name, '')) LIKE LOWER($3)
           OR LOWER(COALESCE(source_campaign.name, inferred_campaign.name, ''))
                LIKE LOWER($3)
         )
       ORDER BY suppression.created_at DESC, suppression.id DESC
       LIMIT $4 OFFSET $5`,
      [userId, reason === "all" ? "" : reason, searchPattern, pageSize, (page - 1) * pageSize],
    ),
    query(
      `SELECT COUNT(*)::int AS all_count,
              COUNT(*) FILTER (WHERE reason = 'unsubscribe')::int AS unsubscribe_count,
              COUNT(*) FILTER (WHERE reason = 'bounce')::int AS bounce_count,
              COUNT(*) FILTER (WHERE reason = 'complaint')::int AS complaint_count,
              COUNT(*) FILTER (WHERE reason = 'manual')::int AS manual_count
       FROM email_suppressions
       WHERE user_id = $1`,
      [userId],
    ),
    query(
      `SELECT COUNT(*)::int AS total
       FROM email_suppressions suppression
       LEFT JOIN contacts contact
         ON contact.created_by = suppression.user_id
        AND LOWER(TRIM(contact.email)) = LOWER(TRIM(suppression.recipient))
       LEFT JOIN contact_campaign_messages source_message
         ON source_message.id = suppression.source_message_id
       LEFT JOIN contact_campaigns source_campaign
         ON source_campaign.id = source_message.campaign_id
        AND source_campaign.user_id = suppression.user_id
       LEFT JOIN LATERAL (
         SELECT campaign.name
         FROM contact_campaign_messages message
         JOIN contact_campaigns campaign
           ON campaign.id = message.campaign_id
          AND campaign.user_id = suppression.user_id
         WHERE LOWER(TRIM(message.recipient)) =
                 LOWER(TRIM(suppression.recipient))
         ORDER BY message.created_at DESC
         LIMIT 1
       ) inferred_campaign ON TRUE
       WHERE suppression.user_id = $1
         AND ($2 = '' OR suppression.reason = $2)
         AND (
           $3 = '%%'
           OR LOWER(suppression.recipient) LIKE LOWER($3)
           OR LOWER(COALESCE(contact.full_name, '')) LIKE LOWER($3)
           OR LOWER(COALESCE(source_campaign.name, inferred_campaign.name, ''))
                LIKE LOWER($3)
         )`,
      [userId, reason === "all" ? "" : reason, searchPattern],
    ),
  ]);

  const countRow = (countResult.rows[0] || {}) as DatabaseRow;
  const total = asNumber(
    (filteredCountResult.rows[0] as DatabaseRow | undefined)?.total,
  );
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rows = rowsResult.rows.map((raw) => {
    const row = raw as DatabaseRow;
    const rowReason = asString(row.reason) as CampaignSuppressionReason;
    return {
      id: asString(row.id),
      recipient: asString(row.recipient),
      reason: campaignSuppressionReasons.has(rowReason) ? rowReason : "manual",
      reasonDetail: asString(row.reason_detail),
      createdAt: asString(row.created_at),
      contactId: asString(row.contact_id) || null,
      contactName: asString(row.contact_name) || asString(row.recipient),
      sourceCampaignId: asString(row.source_campaign_id) || null,
      sourceCampaignName: asString(row.source_campaign_name),
    } satisfies CampaignSuppressionRecord;
  });

  return {
    rows,
    total,
    page: Math.min(page, pageCount),
    pageSize,
    pageCount,
    counts: {
      all: asNumber(countRow.all_count),
      unsubscribe: asNumber(countRow.unsubscribe_count),
      bounce: asNumber(countRow.bounce_count),
      complaint: asNumber(countRow.complaint_count),
      manual: asNumber(countRow.manual_count),
    },
  };
}

export async function removeCampaignSuppressions(
  userId: string,
  suppressionIds: unknown,
) {
  const ids = Array.from(
    new Set(
      (Array.isArray(suppressionIds) ? suppressionIds : [])
        .map((value) => String(value || "").trim())
        .filter(isUuidValue),
    ),
  ).slice(0, 500);
  if (!ids.length) throw new DataError("Select at least one suppression.");

  const result = await query<{ removed_count: number; resubscribed_count: number }>(
    `WITH removed AS (
       DELETE FROM email_suppressions
       WHERE user_id = $1 AND id = ANY($2::uuid[])
       RETURNING LOWER(TRIM(recipient)) AS recipient
     ),
     cleared_contacts AS (
       UPDATE contacts contact
       SET unsubscribed_at = NULL,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE contact.created_by = $1
         AND LOWER(TRIM(contact.email)) IN (
           SELECT recipient FROM removed
         )
         AND NOT EXISTS (
           SELECT 1
           FROM email_suppressions remaining
           WHERE remaining.user_id = $1
             AND LOWER(TRIM(remaining.recipient)) = LOWER(TRIM(contact.email))
         )
       RETURNING contact.id
     )
     SELECT (SELECT COUNT(*) FROM removed)::int AS removed_count,
            (SELECT COUNT(*) FROM cleared_contacts)::int AS resubscribed_count`,
    [userId, ids],
  );
  const row = (result.rows[0] || {}) as DatabaseRow;
  return {
    removed: asNumber(row.removed_count),
    resubscribed: asNumber(row.resubscribed_count),
  };
}

/**
 * Permanently removes the CRM contact behind selected suppression records.
 *
 * This is intentionally separate from removeCampaignSuppressions. Removing a
 * suppression is the reversible compliance action; this action is the
 * destructive contact deletion action. Campaign messages are detached first
 * so delivery history and analytics remain available for reporting while the
 * CRM profile, list memberships, activity, and suppression record disappear.
 */
export async function deleteCampaignSuppressionsFromSystem(
  userId: string,
  suppressionIds: unknown,
) {
  const ids = Array.from(
    new Set(
      (Array.isArray(suppressionIds) ? suppressionIds : [])
        .map((value) => String(value || "").trim())
        .filter(isUuidValue),
    ),
  ).slice(0, 500);
  if (!ids.length) throw new DataError("Select at least one suppression.");

  const sql = database();
  const [detachedMessages, deletedContacts, deletedSuppressions] =
    await sql.transaction((transaction) => [
      transaction`
        UPDATE contact_campaign_messages message
        SET contact_id = NULL,
            updated_at = NOW()
        WHERE message.contact_id IN (
          SELECT contact.id
          FROM contacts contact
          WHERE contact.created_by = ${userId}
            AND EXISTS (
              SELECT 1
              FROM email_suppressions suppression
              WHERE suppression.user_id = ${userId}
                AND suppression.id = ANY(${ids}::uuid[])
                AND LOWER(TRIM(suppression.recipient)) = LOWER(TRIM(contact.email))
            )
        )
        RETURNING message.id
      `,
      transaction`
        DELETE FROM contacts contact
        WHERE contact.created_by = ${userId}
          AND EXISTS (
            SELECT 1
            FROM email_suppressions suppression
            WHERE suppression.user_id = ${userId}
              AND suppression.id = ANY(${ids}::uuid[])
              AND LOWER(TRIM(suppression.recipient)) = LOWER(TRIM(contact.email))
          )
        RETURNING contact.id
      `,
      transaction`
        DELETE FROM email_suppressions suppression
        WHERE suppression.user_id = ${userId}
          AND suppression.id = ANY(${ids}::uuid[])
        RETURNING suppression.id
      `,
    ]);

  return {
    removed: deletedSuppressions.length,
    contactsDeleted: deletedContacts.length,
    messagesDetached: detachedMessages.length,
  };
}

const assertCustomAudienceIsEligible = async (
  userId: string,
  audience: ReturnType<typeof normalizeCampaignAudience>,
) => {
  if (audience.audienceMode !== "custom") return;
  const preview = await getCampaignAudiencePreview(userId, {
    audienceMode: "custom",
    customRecipients: audience.customRecipients,
  });
  if (!preview.blockedRecipients.length) return;
  const shown = preview.blockedRecipients.slice(0, 3).join(", ");
  const suffix = preview.blockedRecipients.length > 3 ? " and others" : "";
  throw new DataError(
    `${shown}${suffix} ${preview.blockedRecipients.length === 1 ? "is" : "are"} already unsubscribed or suppressed. Remove ${preview.blockedRecipients.length === 1 ? "this address" : "these addresses"} before saving the audience.`,
  );
};

export async function saveContactCampaign(
  userId: string,
  input: {
    id?: string;
    name: string;
    listId?: string;
    listIds?: string[];
    audienceMode?: CampaignAudienceMode;
    customRecipients?: string[];
    excludeListId?: string | null;
    subject: string;
    previewText?: string;
    htmlBody: string;
    blocks?: unknown[];
    category?: string;
    sendStrategy?: string;
    recurrenceRule?: string;
    recurrenceRequiresReview?: boolean;
    spamScore?: number | null;
    identityId?: string | null;
    aiGenerated?: boolean;
  },
) {
  const name = input.name.trim();
  const subject = input.subject.trim();
  if (!name || !subject) {
    throw new DataError("A campaign needs a name and a subject line.");
  }
  const selectedAudience = normalizeCampaignAudience(input);
  await assertCustomAudienceIsEligible(userId, selectedAudience);
  if (selectedAudience.audienceMode === "lists") {
    const owned = await query(
      `SELECT id FROM contact_lists
       WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, selectedAudience.listIds],
    );
    if (owned.rowCount !== selectedAudience.listIds.length) {
      throw new DataError("One of the selected audiences is not available.");
    }
  }
  const excludeListId =
    selectedAudience.audienceMode === "lists" && input.excludeListId
      ? await requireOwnedList(userId, input.excludeListId)
      : null;
  if (excludeListId && selectedAudience.listIds.includes(excludeListId)) {
    throw new DataError(
      "An exclusion list has to be different from every selected audience.",
    );
  }
  const sendStrategy = campaignSendStrategies.has(input.sendStrategy || "")
    ? String(input.sendStrategy)
    : "immediate";
  const updateSendStrategy =
    input.sendStrategy === undefined ? null : sendStrategy;
  const updateRecurrenceRule =
    input.recurrenceRule === undefined ? null : input.recurrenceRule.trim();
  const updateRecurrenceRequiresReview =
    input.recurrenceRequiresReview === undefined
      ? null
      : input.recurrenceRequiresReview !== false;
  const blocks = campaignBlocks(input.blocks);
  const spamScore =
    input.spamScore == null || !Number.isFinite(Number(input.spamScore))
      ? null
      : Math.min(100, Math.max(0, Number(input.spamScore)));
  const legacyListId = selectedAudience.listIds[0] || null;
  const insertParameters = [
    name,
    legacyListId,
    excludeListId,
    selectedAudience.audienceMode,
    JSON.stringify(selectedAudience.listIds),
    JSON.stringify(selectedAudience.customRecipients),
    subject,
    input.previewText?.trim() || "",
    input.htmlBody.trim(),
    JSON.stringify(blocks),
    input.category?.trim() || "newsletter",
    sendStrategy,
    input.recurrenceRule?.trim() || "",
    input.recurrenceRequiresReview !== false,
    spamScore,
    input.identityId || null,
    Boolean(input.aiGenerated),
  ];
  const updateParameters = [
    name,
    legacyListId,
    excludeListId,
    selectedAudience.audienceMode,
    JSON.stringify(selectedAudience.listIds),
    JSON.stringify(selectedAudience.customRecipients),
    subject,
    input.previewText?.trim() || "",
    input.htmlBody.trim(),
    JSON.stringify(blocks),
    input.category?.trim() || "newsletter",
    updateSendStrategy,
    updateRecurrenceRule,
    updateRecurrenceRequiresReview,
    spamScore,
    input.identityId || null,
    Boolean(input.aiGenerated),
  ];
  const creatingCampaign = !input.id;
  const result = input.id
    ? await query(
        `UPDATE contact_campaigns
         SET name = $1, list_id = $2, exclude_list_id = $3,
             audience_mode = $4, audience_list_ids = $5::jsonb,
             custom_recipients = $6::jsonb, subject = $7,
             preview_text = $8, html_body = $9, blocks = $10::jsonb,
             category = $11, send_strategy = COALESCE($12, send_strategy),
             recurrence_rule = COALESCE($13, recurrence_rule),
             recurrence_requires_review = COALESCE($14, recurrence_requires_review),
             spam_score = $15,
             identity_id = $16, ai_generated = $17, updated_at = NOW()
         WHERE id = $18 AND user_id = $19
           AND (
             status = 'draft'
             OR (
               status IN ('scheduled', 'paused')
               AND NOT (
                 status = 'scheduled'
                 AND scheduled_at IS NOT NULL
                 AND scheduled_at <= NOW()
               )
               AND sent_at IS NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM campaign_send_batches batch
                 WHERE batch.campaign_id = contact_campaigns.id
                   AND batch.dispatched_at IS NOT NULL
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM contact_campaign_messages message
                 WHERE message.campaign_id = contact_campaigns.id
                   AND message.sent_at IS NOT NULL
               )
             )
           )
         RETURNING id`,
        [...updateParameters, input.id, userId],
      )
    : await query(
        `INSERT INTO contact_campaigns (
           name, list_id, exclude_list_id, audience_mode, audience_list_ids,
           custom_recipients, subject, preview_text, html_body, blocks, category,
           send_strategy, recurrence_rule, recurrence_requires_review, spam_score,
           identity_id, ai_generated, user_id, status, created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb, $11,
           $12, $13, $14, $15, $16, $17, $18, 'draft', NOW(), NOW()
         )
         RETURNING id`,
        [...insertParameters, userId],
      );
  if (!result.rows[0]) {
    throw new DataError(
      "Only a campaign that has not started sending can be edited. Duplicate a sent or in-progress campaign to reuse it.",
    );
  }
  const campaignId = asString((result.rows[0] as DatabaseRow).id);
  await syncCampaignLinks(campaignId, blocks);
  if (creatingCampaign) {
    emitCampaignLifecycleEvent(
      userId,
      campaignId,
      "campaign_created",
      `campaign_created:${campaignId}`,
      { category: input.category?.trim() || "newsletter" },
    );
  }
  return campaignId;
}

/**
 * Registers every link in the campaign body against the block that owns it so
 * clicks resolve to a position in the template. Links that disappear from the
 * body are removed, and click counts on surviving links are preserved.
 */
async function syncCampaignLinks(campaignId: string, blocks: unknown[]) {
  const links: Array<{ blockId: string; label: string; url: string }> = [];
  const collect = (block: Record<string, unknown>) => {
    const blockId = asString(block.id);
    const href = asString(block.href).trim();
    if (/^https?:\/\//i.test(href)) {
      links.push({
        blockId,
        label: asString(block.content).trim() || asString(block.type),
        url: href.slice(0, 2048),
      });
    }
    const nested = Array.isArray(block.items) ? block.items : [];
    nested.forEach((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const nestedHref = asString(
          (item as Record<string, unknown>).href,
        ).trim();
        if (/^https?:\/\//i.test(nestedHref)) {
          links.push({
            blockId,
            label:
              asString((item as Record<string, unknown>).title).trim() ||
              asString((item as Record<string, unknown>).label).trim() ||
              asString(block.type),
            url: nestedHref.slice(0, 2048),
          });
        }
      }
    });
  };
  blocks.forEach((block) => {
    if (block && typeof block === "object" && !Array.isArray(block)) {
      collect(block as Record<string, unknown>);
    }
  });

  const unique = new Map(
    links.map((link) => [`${link.blockId}|${link.url}`, link]),
  );
  const keys = Array.from(unique.values());
  if (keys.length) {
    await query(
      `INSERT INTO contact_campaign_links (
         campaign_id, block_id, label, url, created_at, updated_at
       )
       SELECT $1, entry.block_id, entry.label, entry.url, NOW(), NOW()
       FROM jsonb_to_recordset($2::jsonb)
         AS entry(block_id TEXT, label TEXT, url TEXT)
       ON CONFLICT (campaign_id, block_id, url)
       DO UPDATE SET label = EXCLUDED.label, updated_at = NOW()`,
      [
        campaignId,
        JSON.stringify(
          keys.map((link) => ({
            block_id: link.blockId,
            label: link.label.slice(0, 160),
            url: link.url,
          })),
        ),
      ],
    );
  }
  await query(
    `DELETE FROM contact_campaign_links
     WHERE campaign_id = $1
       AND (block_id || '|' || url) <> ALL($2::text[])`,
    [campaignId, keys.map((link) => `${link.blockId}|${link.url}`)],
  );
}

export async function duplicateContactCampaign(
  userId: string,
  campaignId: string,
) {
  const result = await query(
    `INSERT INTO contact_campaigns (
       user_id, name, list_id, exclude_list_id, audience_mode,
       audience_list_ids, custom_recipients, subject, preview_text, html_body,
       blocks, category, send_strategy, recurrence_rule,
       recurrence_requires_review, spam_score, identity_id, ai_generated,
       status, created_at, updated_at
     )
     SELECT campaign.user_id,
            LEFT(campaign.name || ' copy', 200),
            campaign.list_id, campaign.exclude_list_id, campaign.audience_mode,
            campaign.audience_list_ids, campaign.custom_recipients,
            campaign.subject, campaign.preview_text, campaign.html_body,
            campaign.blocks,
            campaign.category, campaign.send_strategy,
            campaign.recurrence_rule, campaign.recurrence_requires_review,
            campaign.spam_score, campaign.identity_id, campaign.ai_generated,
            'draft', NOW(), NOW()
     FROM contact_campaigns campaign
     WHERE campaign.id = $1 AND campaign.user_id = $2
     RETURNING id, blocks`,
    [campaignId, userId],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row) throw new DataError("That campaign is not available.");
  const duplicateId = asString(row.id);
  await syncCampaignLinks(duplicateId, asJson<unknown[]>(row.blocks, []));
  return duplicateId;
}

/**
 * Resolves the contacts a list currently targets. A dynamic segment is
 * evaluated live with the same matcher the Contacts module uses, so the count
 * shown in the Audience tab matches what a send would queue right now.
 */
const resolveListContactIds = async (userId: string, listId: string) => {
  const listResult = await query(
    `SELECT id, list_type, filter_definition
     FROM contact_lists
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [listId, userId],
  );
  const listRow = listResult.rows[0] as DatabaseRow | undefined;
  if (!listRow) return [] as string[];
  if (asString(listRow.list_type) === "dynamic") {
    const rules = asJson<ContactSegmentRule[]>(listRow.filter_definition, []);
    const contacts = await listContacts(userId, { limit: 5000 });
    return contacts
      .filter((contact) => contactMatchesSegment(contact, rules))
      .map((contact) => contact.id);
  }
  const members = await query(
    `SELECT member.contact_id
     FROM contact_list_members member
     JOIN contacts contact ON contact.id = member.contact_id
     WHERE member.list_id = $1 AND contact.created_by = $2`,
    [listId, userId],
  );
  return members.rows.map((row) => asString((row as DatabaseRow).contact_id));
};

export async function getCampaignAudiencePreview(
  userId: string,
  input: {
    audienceMode?: CampaignAudienceMode;
    listIds?: string[];
    listId?: string;
    excludeListId?: string | null;
    customRecipients?: string[];
  },
) {
  const audience = normalizeCampaignAudience(input);
  const excludeListId = input.excludeListId
    ? await requireOwnedList(userId, input.excludeListId)
    : null;

  if (audience.audienceMode === "custom") {
    if (excludeListId) {
      throw new DataError("Custom email audiences cannot use a list exclusion.");
    }
    const base: CampaignAudiencePreview = {
      audienceMode: "custom",
      listId: "",
      listName: "Custom email addresses",
      listIds: [],
      listNames: [],
      customRecipientCount: audience.customRecipients.length,
      excludeListId: null,
      excludeListName: "",
      totalInList: audience.customRecipients.length,
      excluded: 0,
      unsubscribed: 0,
      suppressed: 0,
      missingEmail: 0,
      deliverable: 0,
      blockedRecipients: [],
      sample: [],
    };
    const breakdown = await query(
      `WITH requested AS (
         SELECT DISTINCT LOWER(TRIM(requested.email)) AS email
         FROM jsonb_array_elements_text($2::jsonb) AS requested(email)
       ), candidate AS (
         SELECT requested.email, contact.id, contact.full_name,
                contact.unsubscribed_at,
                (suppression.id IS NOT NULL) AS suppressed
         FROM requested
         LEFT JOIN LATERAL (
           SELECT id, full_name, unsubscribed_at
           FROM contacts
           WHERE created_by = $1
             AND LOWER(TRIM(email)) = requested.email
           ORDER BY id
           LIMIT 1
         ) contact ON TRUE
         LEFT JOIN email_suppressions suppression
           ON suppression.user_id = $1
          AND LOWER(TRIM(suppression.recipient)) = requested.email
       )
       SELECT
         COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribed,
         COUNT(*) FILTER (WHERE unsubscribed_at IS NULL AND suppressed)::int AS suppressed,
         COUNT(*) FILTER (WHERE unsubscribed_at IS NULL AND NOT suppressed)::int AS deliverable,
         ARRAY_AGG(email ORDER BY email) FILTER (
           WHERE unsubscribed_at IS NOT NULL OR suppressed
         ) AS blocked_recipients
       FROM candidate`,
      [userId, JSON.stringify(audience.customRecipients)],
    );
    const row = (breakdown.rows[0] || {}) as DatabaseRow;
    const sampleRows = await query(
      `WITH requested AS (
         SELECT DISTINCT LOWER(TRIM(requested.email)) AS email
         FROM jsonb_array_elements_text($2::jsonb) AS requested(email)
       )
       SELECT COALESCE(contact.id::text, 'custom:' || requested.email) AS id,
              COALESCE(NULLIF(contact.full_name, ''), requested.email) AS full_name,
              requested.email
       FROM requested
       LEFT JOIN LATERAL (
         SELECT id, full_name, unsubscribed_at
         FROM contacts
         WHERE created_by = $1
           AND LOWER(TRIM(email)) = requested.email
         ORDER BY id
         LIMIT 1
       ) contact ON TRUE
       LEFT JOIN email_suppressions suppression
         ON suppression.user_id = $1
        AND LOWER(TRIM(suppression.recipient)) = requested.email
       WHERE contact.unsubscribed_at IS NULL
         AND suppression.id IS NULL
       ORDER BY requested.email
       LIMIT 8`,
      [userId, JSON.stringify(audience.customRecipients)],
    );
    return {
      ...base,
      unsubscribed: asNumber(row.unsubscribed),
      suppressed: asNumber(row.suppressed),
      deliverable: asNumber(row.deliverable),
      blockedRecipients: asStringArray(row.blocked_recipients),
      sample: sampleRows.rows.map((value) => {
        const contact = value as DatabaseRow;
        return {
          id: asString(contact.id),
          name: asString(contact.full_name),
          email: asString(contact.email),
        };
      }),
    } satisfies CampaignAudiencePreview;
  }

  const listResult = await query(
    `SELECT id, name
     FROM contact_lists
     WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, audience.listIds],
  );
  if (listResult.rowCount !== audience.listIds.length) {
    throw new DataError("One of the selected audiences is not available.");
  }
  const listById = new Map(
    listResult.rows.map((row) => {
      const value = row as DatabaseRow;
      return [asString(value.id), asString(value.name)] as const;
    }),
  );
  const listNames = audience.listIds.map((id) => listById.get(id) || id);
  const targetIds = Array.from(
    new Set(
      (
        await Promise.all(
          audience.listIds.map((listId) => resolveListContactIds(userId, listId)),
        )
      ).flat(),
    ),
  );
  const excludeIds = excludeListId
    ? await resolveListContactIds(userId, excludeListId)
    : [];
  const excludeSet = new Set(excludeIds);
  const remainingIds = targetIds.filter((id) => !excludeSet.has(id));

  const emptyPreview: CampaignAudiencePreview = {
    audienceMode: "lists",
    listId: audience.listIds[0] || "",
    listName: listNames.length === 1 ? listNames[0] : `${listNames.length} lists`,
    listIds: audience.listIds,
    listNames,
    customRecipientCount: 0,
    excludeListId,
    excludeListName: excludeListId
      ? asString(
          (
            await query(
              `SELECT name FROM contact_lists WHERE id = $1 AND user_id = $2 LIMIT 1`,
              [excludeListId, userId],
            )
          ).rows[0]?.name,
        )
      : "",
    totalInList: targetIds.length,
    excluded: targetIds.length - remainingIds.length,
    unsubscribed: 0,
    suppressed: 0,
    missingEmail: 0,
    deliverable: 0,
    blockedRecipients: [],
    sample: [],
  };
  if (!remainingIds.length) return emptyPreview;

  const breakdown = await query(
     `WITH candidate AS (
       SELECT contact.id, contact.email, contact.unsubscribed_at,
         (suppression.id IS NOT NULL) AS suppressed
       FROM contacts contact
       LEFT JOIN email_suppressions suppression
         ON suppression.user_id = contact.created_by
        AND LOWER(suppression.recipient) = LOWER(contact.email)
        WHERE contact.created_by = $1 AND contact.id = ANY($2::uuid[])
      ),
      deliverable AS (
        SELECT id FROM candidate
        WHERE unsubscribed_at IS NULL
          AND NOT suppressed
          AND LENGTH(TRIM(email)) > 3
      )
     SELECT
       (SELECT COUNT(*) FROM candidate
         WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribed,
       (SELECT COUNT(*) FROM candidate
         WHERE unsubscribed_at IS NULL AND suppressed)::int AS suppressed,
       (SELECT COUNT(*) FROM candidate
         WHERE unsubscribed_at IS NULL AND NOT suppressed
           AND LENGTH(TRIM(email)) <= 3)::int AS missing_email,
        (SELECT COUNT(*) FROM deliverable)::int AS deliverable`,
     [userId, remainingIds],
  );
  const row = (breakdown.rows[0] || {}) as DatabaseRow;

  // A count alone does not tell someone whether they picked the right list.
  // A handful of the actual people who will receive this does.
  const sampleRows = await query(
    `SELECT contact.id, contact.full_name, contact.email
     FROM contacts contact
     LEFT JOIN email_suppressions suppression
       ON suppression.user_id = contact.created_by
      AND LOWER(suppression.recipient) = LOWER(contact.email)
     WHERE contact.created_by = $1
       AND contact.id = ANY($2::uuid[])
       AND contact.unsubscribed_at IS NULL
       AND suppression.id IS NULL
       AND LENGTH(TRIM(contact.email)) > 3
       AND LOWER(TRIM(contact.email)) ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][a-z0-9-]{2,}$'
       ORDER BY contact.full_name NULLS LAST, contact.email
       LIMIT 8`,
    [userId, remainingIds],
  );

  return {
    ...emptyPreview,
    unsubscribed: asNumber(row.unsubscribed),
    suppressed: asNumber(row.suppressed),
    missingEmail: asNumber(row.missing_email),
    deliverable: asNumber(row.deliverable),
    blockedRecipients: [],
    sample: sampleRows.rows.map((value) => {
      const contact = value as DatabaseRow;
      return {
        id: asString(contact.id),
        name: asString(contact.full_name),
        email: asString(contact.email),
      };
    }),
  } satisfies CampaignAudiencePreview;
}

/**
 * A campaign cannot leave the workspace without a physical mailing address in
 * its footer, which regulations such as CAN-SPAM require. The block is named
 * explicitly so the sender can fix it instead of guessing why a send failed.
 */
const assertCampaignCompliance = async (userId: string) => {
  const settings = await getCampaignSettings(userId);
  if (!settings.mailingAddress.trim()) {
    throw new DataError(
      "Add your physical mailing address in Campaigns settings before sending. Marketing email is required to carry one.",
    );
  }
  if (!campaignSendAllowed()) {
    const deployed =
      process.env.NODE_ENV === "production" ||
      Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    throw new DataError(
      deployed
        ? "Set PUBLIC_APP_URL to the stable HTTPS address of this MaxForm deployment before sending campaigns so unsubscribe and engagement links work."
        : "Development campaign sending is disabled. Enable it explicitly only for a local smoke test.",
    );
  }
  return settings;
};

/**
 * Timezone-optimized sends stagger each recipient to the same wall-clock hour
 * in their own timezone. A contact with no timezone on file keeps the
 * workspace's chosen instant rather than being dropped from the send.
 */
const queueCampaignRecipients = async (
  userId: string,
  campaignId: string,
  sendAt: string,
  strategy: ContactCampaignSendStrategy,
) => {
  const timezoneAware = strategy === "timezone_optimized";
  const result = await query(
    `WITH target AS (
     SELECT campaign.id, campaign.audience_mode, campaign.exclude_list_id,
            CASE
              WHEN jsonb_array_length(COALESCE(campaign.audience_list_ids, '[]'::jsonb)) > 0
                THEN campaign.audience_list_ids
              WHEN campaign.list_id IS NOT NULL
                THEN jsonb_build_array(campaign.list_id::text)
              ELSE '[]'::jsonb
            END AS list_ids,
            COALESCE(campaign.custom_recipients, '[]'::jsonb) AS custom_recipients,
            COALESCE(regional.timezone, 'UTC') AS workspace_timezone
       FROM contact_campaigns campaign
       LEFT JOIN workspace_regional_settings regional
         ON regional.user_id = campaign.user_id
      WHERE campaign.id = $1 AND campaign.user_id = $2
     ),
     excluded AS (
       SELECT DISTINCT member.contact_id
       FROM target
       CROSS JOIN LATERAL jsonb_array_elements_text(target.list_ids) AS list_value(list_id)
       JOIN contact_list_members member
         ON member.list_id = list_value.list_id::uuid
       WHERE target.audience_mode = 'lists'
         AND target.exclude_list_id IS NOT NULL
     ),
     list_eligible AS (
       SELECT DISTINCT ON (LOWER(TRIM(contact.email)))
              contact.id AS contact_id, contact.email AS recipient,
              contact.timezone,
                       target.workspace_timezone
       FROM target
       CROSS JOIN LATERAL jsonb_array_elements_text(target.list_ids) AS list_value(list_id)
       JOIN contact_list_members member
         ON member.list_id = list_value.list_id::uuid
       JOIN contacts contact ON contact.id = member.contact_id
       LEFT JOIN email_suppressions suppression
         ON suppression.user_id = contact.created_by
        AND LOWER(suppression.recipient) = LOWER(contact.email)
       WHERE target.audience_mode = 'lists'
         AND contact.created_by = $2
         AND contact.unsubscribed_at IS NULL
         AND suppression.id IS NULL
         AND LENGTH(TRIM(contact.email)) > 3
         AND NOT EXISTS (
           SELECT 1 FROM excluded WHERE excluded.contact_id = contact.id
         )
       ORDER BY LOWER(TRIM(contact.email)), contact.id
     ),
     custom_requested AS (
       SELECT DISTINCT LOWER(TRIM(requested.email)) AS recipient,
              target.workspace_timezone
       FROM target
       CROSS JOIN LATERAL jsonb_array_elements_text(target.custom_recipients) AS requested(email)
       WHERE target.audience_mode = 'custom'
     ),
     custom_eligible AS (
       SELECT contact.id AS contact_id, requested.recipient,
              contact.timezone, requested.workspace_timezone
       FROM custom_requested requested
       LEFT JOIN LATERAL (
         SELECT id, email, timezone, unsubscribed_at
         FROM contacts
         WHERE created_by = $2
           AND LOWER(TRIM(email)) = requested.recipient
         ORDER BY id
         LIMIT 1
       ) contact ON TRUE
       LEFT JOIN email_suppressions suppression
         ON suppression.user_id = $2
        AND LOWER(TRIM(suppression.recipient)) = requested.recipient
       WHERE (contact.id IS NULL OR contact.unsubscribed_at IS NULL)
         AND suppression.id IS NULL
         AND requested.recipient ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][a-z0-9-]{2,}$'
     ),
     eligible AS (
       SELECT contact_id, recipient, timezone, workspace_timezone
       FROM list_eligible
       UNION ALL
       SELECT contact_id, recipient, timezone, workspace_timezone
       FROM custom_eligible
      ),
     queued AS (
       INSERT INTO contact_campaign_messages (
         campaign_id, contact_id, recipient, status, scheduled_for,
         created_at, updated_at
       )
       SELECT $1, eligible.contact_id, eligible.recipient, 'queued',
              CASE
                WHEN $4 AND LENGTH(TRIM(eligible.timezone)) > 0
                  THEN (
                    ($3::timestamptz AT TIME ZONE eligible.workspace_timezone)
                      AT TIME ZONE eligible.timezone
                  )
                ELSE $3::timestamptz
              END,
              NOW(), NOW()
       FROM eligible
       ON CONFLICT (campaign_id, recipient_key) DO UPDATE SET
         contact_id = COALESCE(EXCLUDED.contact_id, contact_campaign_messages.contact_id),
         recipient = EXCLUDED.recipient,
         status = 'queued',
         scheduled_for = EXCLUDED.scheduled_for,
         updated_at = NOW()
       RETURNING id
     )
     SELECT (SELECT COUNT(*) FROM queued)::int AS queued_count,
            (SELECT id FROM target) AS campaign_id`,
    [campaignId, userId, sendAt, timezoneAware],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row?.campaign_id) throw new DataError("That campaign is not available.");
  return asNumber(row.queued_count);
};

/**
 * A dynamic segment is materialized into list members before a send so the
 * queue is a snapshot of who matched at send time, not a moving target.
 */
const materializeCampaignAudience = async (
  userId: string,
  campaignId: string,
) => {
  const campaignResult = await query(
    `SELECT campaign.list_id, campaign.audience_list_ids
     FROM contact_campaigns campaign
     WHERE campaign.id = $1 AND campaign.user_id = $2
     LIMIT 1`,
    [campaignId, userId],
  );
  const campaign = campaignResult.rows[0] as DatabaseRow | undefined;
  if (!campaign) return;
  const listIds = normalizeCampaignListIds(
    asJson<unknown[]>(campaign.audience_list_ids, []),
    campaign.list_id,
  );
  for (const listId of listIds) {
    const listResult = await query(
      `SELECT list.id, list.list_type, list.filter_definition
     FROM contact_campaigns campaign
     JOIN contact_lists list ON list.id = $3 AND list.user_id = campaign.user_id
     WHERE campaign.id = $1 AND campaign.user_id = $2
     LIMIT 1`,
      [campaignId, userId, listId],
    );
    const listRow = listResult.rows[0] as DatabaseRow | undefined;
    if (!listRow || asString(listRow.list_type) !== "dynamic") continue;
    const rules = asJson<ContactSegmentRule[]>(listRow.filter_definition, []);
    const matching = (await listContacts(userId, { limit: 5000 })).filter(
      (contact) => contactMatchesSegment(contact, rules),
    );
    if (!matching.length) continue;
    await addContactsToList(
      userId,
      asString(listRow.id),
      matching.map((contact) => contact.id),
      "segment",
    );
  }
};

/**
 * Clears the not-yet-started queue before a campaign is scheduled again. The
 * message rows must be cleared with their waves: otherwise a recipient from
 * the previous list could keep its batch_id cleared and silently re-enter the
 * next plan after the sender changed the audience.
 */
const resetUnstartedCampaignBatches = async (campaignId: string) => {
  await query(
    `DELETE FROM campaign_send_batches
     WHERE campaign_id = $1 AND dispatched_at IS NULL`,
    [campaignId],
  );
  await query(
    `DELETE FROM contact_campaign_messages message
     WHERE message.campaign_id = $1
       AND message.sent_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM campaign_send_batches batch
         WHERE batch.id = message.batch_id
           AND batch.dispatched_at IS NOT NULL
       )`,
    [campaignId],
  );
};

export async function scheduleContactCampaign(
  userId: string,
  campaignId: string,
  scheduledAt: string,
  options: {
    sendStrategy?: string;
    recurrenceRule?: string;
    recurrenceRequiresReview?: boolean;
  } = {},
) {
  const scheduledTime = new Date(scheduledAt).getTime();
  if (!Number.isFinite(scheduledTime) || scheduledTime <= Date.now()) {
    throw new DataError("Choose a future date and time.");
  }
  await assertCampaignCompliance(userId);
  const strategy = (
    campaignSendStrategies.has(options.sendStrategy || "")
      ? options.sendStrategy
      : "scheduled"
  ) as ContactCampaignSendStrategy;
  if (strategy === "recurring" && !options.recurrenceRule?.trim()) {
    throw new DataError("A recurring campaign needs a repeat rule.");
  }
  await materializeCampaignAudience(userId, campaignId);
  const claimed = await query(
    `UPDATE contact_campaigns
     SET status = 'draft', updated_at = NOW()
     WHERE id = $1 AND user_id = $2
       AND (
         status IN ('draft', 'paused')
         OR (
           status = 'scheduled'
           AND sent_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM campaign_send_batches batch
             WHERE batch.campaign_id = contact_campaigns.id
               AND batch.dispatched_at IS NOT NULL
           )
           AND NOT EXISTS (
             SELECT 1
             FROM contact_campaign_messages message
             WHERE message.campaign_id = contact_campaigns.id
               AND message.sent_at IS NOT NULL
           )
         )
       )
     RETURNING id`,
    [campaignId, userId],
  );
  if (!claimed.rows[0]) {
    throw new DataError(
      "Only a campaign that has not started sending can be scheduled.",
    );
  }
  try {
    await resetUnstartedCampaignBatches(campaignId);
    const queued = await queueCampaignRecipients(
      userId,
      campaignId,
      scheduledAt,
      strategy,
    );
    if (queued > 0) {
      // Plan before exposing the campaign as scheduled. A worker can therefore
      // never see a scheduled campaign without a durable batch to claim.
      await planCampaignSend(userId, campaignId, new Date(scheduledAt));
      const activated = await query(
        `UPDATE contact_campaigns
         SET status = 'scheduled',
             scheduled_at = $3::timestamptz,
             send_strategy = $4,
             recurrence_rule = $5,
             recurrence_requires_review = $6,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'draft'
         RETURNING id`,
        [
          campaignId,
          userId,
          scheduledAt,
          strategy,
          options.recurrenceRule?.trim() || "",
          options.recurrenceRequiresReview !== false,
        ],
      );
      if (!activated.rows[0]) {
        throw new DataError("The campaign could not be scheduled.");
      }
      emitCampaignLifecycleEvent(
        userId,
        campaignId,
        "campaign_queued",
        `campaign_queued:${campaignId}:${scheduledAt}`,
        { recipientCount: queued, strategy },
      );
      emitCampaignLifecycleEvent(
        userId,
        campaignId,
        "campaign_scheduled",
        `campaign_scheduled:${campaignId}:${scheduledAt}`,
        { recipientCount: queued, strategy, scheduledAt },
      );
      await enqueueCampaignOrchestratorJob({
        campaignId,
        workspaceId: userId,
        reason: "scheduled",
        runAt: new Date(scheduledAt),
      });
      return queued;
    }

    // Do not leave an empty audience looking scheduled forever. The user can
    // correct the list, exclusions, or suppression state and try again.
    await query(
      `UPDATE contact_campaigns
       SET status = 'draft', scheduled_at = NULL, send_strategy = 'scheduled',
           recurrence_rule = '', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'draft'`,
      [campaignId, userId],
    );
    throw new DataError(
      "No contact in this audience can currently receive email. Check exclusions, unsubscribes, and suppressions.",
    );
  } catch (error) {
    // A queue/planning failure must not strand the campaign in a half-scheduled
    // state. It remains a draft with no stale batch behind it.
    await query(
      `UPDATE contact_campaigns
       SET status = 'draft', scheduled_at = NULL, send_strategy = 'scheduled',
           recurrence_rule = '', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'draft'`,
      [campaignId, userId],
    );
    await resetUnstartedCampaignBatches(campaignId);
    throw error;
  }
}

export async function sendContactCampaignNow(
  userId: string,
  campaignId: string,
) {
  await assertCampaignCompliance(userId);
  await materializeCampaignAudience(userId, campaignId);
  const sendAt = new Date().toISOString();
  const claimed = await query(
    `UPDATE contact_campaigns
     SET status = 'draft', updated_at = NOW()
     WHERE id = $1 AND user_id = $2
       AND (
         status IN ('draft', 'paused')
         OR (
           status = 'scheduled'
           AND sent_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM campaign_send_batches batch
             WHERE batch.campaign_id = contact_campaigns.id
               AND batch.dispatched_at IS NOT NULL
           )
           AND NOT EXISTS (
             SELECT 1
             FROM contact_campaign_messages message
             WHERE message.campaign_id = contact_campaigns.id
               AND message.sent_at IS NOT NULL
           )
         )
       )
     RETURNING id`,
    [campaignId, userId],
  );
  if (!claimed.rows[0]) {
    throw new DataError(
      "Only a campaign that has not started sending can be sent.",
    );
  }
  await resetUnstartedCampaignBatches(campaignId);
  const queued = await queueCampaignRecipients(
    userId,
    campaignId,
    sendAt,
    "immediate",
  );
  if (!queued) {
    // Nothing was deliverable, so the campaign never actually left. Returning
    // it to draft keeps the list honest instead of showing a phantom send.
    await query(
      `UPDATE contact_campaigns
       SET status = 'draft', scheduled_at = NULL, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [campaignId, userId],
    );
    throw new DataError(
      "No contact in this audience can currently receive email. Check exclusions, unsubscribes, and suppressions.",
    );
  }
  // Small campaigns become one immediate wave. Bulk campaigns retain paced,
  // durable waves and are handed to the orchestrator below.
  const plan = await planCampaignSend(userId, campaignId);
  const started = await query(
    `UPDATE contact_campaigns
     SET status = 'sending',
         send_strategy = 'immediate',
         scheduled_at = $3::timestamptz,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'draft'
     RETURNING id`,
    [campaignId, userId, sendAt],
  );
  if (!started.rows[0]) {
    await resetUnstartedCampaignBatches(campaignId);
    throw new DataError("The campaign could not be started.");
  }
  emitCampaignLifecycleEvent(
    userId,
    campaignId,
    "campaign_queued",
    `campaign_queued:${campaignId}:${sendAt}`,
    {
      recipientCount: queued,
      strategy: "immediate",
      deliveryMode: plan.deliveryMode,
    },
  );

  if (plan.deliveryMode === "direct") {
    try {
      const result = await dispatchFirstCampaignBatch(campaignId, {
        retryOnTemporaryFailure: false,
      });
      if (result.failed > 0) {
        throw new DataError(
          result.sent > 0
            ? `${result.sent} email${result.sent === 1 ? " was" : "s were"} accepted, but ${result.failed} could not be sent. Review the campaign delivery results.`
            : "The provider did not accept this campaign. Review the provider connection and try again.",
          502,
          "campaign_delivery_failed",
        );
      }
      return queued;
    } catch (error) {
      if (error instanceof DataError) throw error;
      const providerStatus = Number(
        (error as { status?: unknown } | null)?.status,
      );
      throw new DataError(
        error instanceof Error
          ? error.message
          : "The campaign could not be sent.",
        Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus < 600
          ? providerStatus
          : 502,
        String(
          (error as { code?: unknown } | null)?.code ||
            "campaign_delivery_failed",
        ),
      );
    }
  }

  try {
    await enqueueCampaignOrchestratorJob({
      campaignId,
      workspaceId: userId,
      reason: "send_now",
    });
  } catch (error) {
    // If Redis is unavailable after the campaign was marked active, return it
    // to a clean draft. Any queued recipient rows belong to not-yet-started
    // waves and can be safely removed; a subsequent attempt will re-materialize
    // the audience and rebuild the plan.
    await resetUnstartedCampaignBatches(campaignId);
    await query(
      `UPDATE contact_campaigns
       SET status = 'draft', scheduled_at = NULL, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'sending'`,
      [campaignId, userId],
    );
    throw error;
  }
  return queued;
}

export async function pauseContactCampaign(
  userId: string,
  campaignId: string,
) {
  const claimed = await query(
    `UPDATE contact_campaigns
     SET status = 'paused', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status IN ('scheduled', 'sending')
     RETURNING id`,
    [campaignId, userId],
  );
  if (!claimed.rows[0]) {
    throw new DataError(
      "Only a scheduled or in-progress campaign can be paused.",
    );
  }
  // Waves that have not been dispatched stop immediately. A wave already handed
  // to the provider is left alone, and its recipients are never re-sent on
  // resume because each message carries a stable idempotency key.
  await pauseCampaignBatches(campaignId);
  const cancelled = await query(
    `UPDATE contact_campaign_messages
     SET status = 'cancelled', updated_at = NOW()
     WHERE campaign_id = $1
        AND status IN ('queued', 'processing')
       AND NOT EXISTS (
         SELECT 1
         FROM campaign_send_batches batch
         WHERE batch.id = contact_campaign_messages.batch_id
           AND batch.status = 'sending'
       )
     RETURNING id`,
    [campaignId],
  );
  return cancelled.rowCount;
}

export async function resumeContactCampaign(
  userId: string,
  campaignId: string,
  scheduledAt?: string,
) {
  const owned = await query(
    `SELECT campaign.status, campaign.scheduled_at, campaign.send_strategy,
            campaign.recurrence_rule, campaign.recurrence_requires_review,
            campaign.sent_at,
            EXISTS (
              SELECT 1
              FROM campaign_send_batches batch
              WHERE batch.campaign_id = campaign.id
                AND batch.dispatched_at IS NOT NULL
            ) AS send_started,
            EXISTS (
              SELECT 1
              FROM contact_campaign_messages message
              WHERE message.campaign_id = campaign.id
                AND message.sent_at IS NOT NULL
            ) AS message_started
            ,(
              campaign.status = 'scheduled'
              AND campaign.scheduled_at IS NOT NULL
              AND campaign.scheduled_at <= NOW()
            ) AS due_now
     FROM contact_campaigns campaign
     WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [campaignId, userId],
  );
  const current = owned.rows[0] as DatabaseRow | undefined;
  if (!current) throw new DataError("That campaign is not available.");
  if (asString(current.status) !== "paused") {
    throw new DataError("Only a paused campaign can be resumed.");
  }

  const started =
    asBoolean(current.send_started) ||
    asBoolean(current.message_started) ||
    Boolean(current.sent_at);
  if (!started) {
    const originalScheduledAt = asString(current.scheduled_at);
    const requestedScheduledAt = asString(scheduledAt);
    const nextScheduledAt = requestedScheduledAt || originalScheduledAt;
    if (!nextScheduledAt || new Date(nextScheduledAt).getTime() <= Date.now()) {
      throw new DataError(
        "The original send time has passed. Choose a new future time to resume this campaign.",
      );
    }
    const storedStrategy = campaignSendStrategies.has(
      asString(current.send_strategy),
    )
      ? asString(current.send_strategy)
      : "scheduled";
    const strategy = storedStrategy === "immediate" ? "scheduled" : storedStrategy;
    return scheduleContactCampaign(userId, campaignId, nextScheduledAt, {
      sendStrategy: strategy,
      recurrenceRule: asString(current.recurrence_rule),
      recurrenceRequiresReview:
        current.recurrence_requires_review == null
          ? true
          : asBoolean(current.recurrence_requires_review),
    });
  }

  // A campaign with waves already planned picks up exactly where it stopped.
  // A pre-send pause is handled above so it can preserve or replace its time.
  const restored = await resumeCampaignBatches(campaignId);
  if (restored) {
    await query(
      `UPDATE contact_campaigns
       SET status = 'sending', updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [campaignId, userId],
    );
    try {
      await enqueueCampaignOrchestratorJob({
        campaignId,
        workspaceId: userId,
        reason: "resume",
      });
    } catch (error) {
      await pauseCampaignBatches(campaignId);
      await query(
        `UPDATE contact_campaigns
         SET status = 'paused', updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'sending'`,
        [campaignId, userId],
      );
      throw error;
    }
    return restored;
  }
  return restored;
}

/** Requeues only failed recipients while preserving every accepted message. */
export async function retryFailedCampaignRecipients(
  userId: string,
  campaignId: string,
) {
  const owned = await query(
    `SELECT id, status
     FROM contact_campaigns
     WHERE id = $1::uuid AND user_id = $2::uuid
     LIMIT 1`,
    [campaignId, userId],
  );
  if (!owned.rows[0]) throw new DataError("That campaign is not available.");
  const reset = await query(
    `UPDATE contact_campaign_messages
     SET status = 'queued', batch_id = NULL, processing_started_at = NULL,
         failure_reason = '', failure_kind = '', suppression_reason = '',
         skipped_at = NULL, last_error = NULL, updated_at = NOW()
     WHERE campaign_id = $1::uuid
       AND status IN ('failed', 'soft_bounce', 'hard_bounce')
     RETURNING id`,
    [campaignId],
  );
  if (!reset.rowCount) return 0;
  await query(
    `UPDATE contact_campaigns
     SET status = 'sending', send_strategy = 'immediate',
         scheduled_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid AND user_id = $2::uuid`,
    [campaignId, userId],
  );
  await planCampaignSend(userId, campaignId, new Date());
  try {
    await enqueueCampaignOrchestratorJob({
      campaignId,
      workspaceId: userId,
      reason: "retry",
    });
  } catch (error) {
    await pauseCampaignBatches(campaignId);
    await query(
      `UPDATE contact_campaigns
       SET status = 'paused', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'sending'`,
      [campaignId, userId],
    );
    throw error;
  }
  return reset.rowCount;
}

export async function cancelContactCampaign(
  userId: string,
  campaignId: string,
) {
  const owned = await query(
    `SELECT id FROM contact_campaigns
     WHERE id = $1::uuid AND user_id = $2::uuid
       AND status IN ('scheduled', 'queued', 'sending', 'paused')
     LIMIT 1`,
    [campaignId, userId],
  );
  if (!owned.rows[0]) throw new DataError("Only an active campaign can be cancelled.");
  await cancelCampaignDelivery(userId, [campaignId]);
  return true;
}

export async function listContactCampaignRecipients(
  userId: string,
  campaignId: string,
  options: { status?: string; page?: number; pageSize?: number } = {},
) {
  const pageSize = Math.max(1, Math.min(200, Math.floor(Number(options.pageSize) || 50)));
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const status = String(options.status || "").trim().toLowerCase();
  const allowed = new Set([
    "queued", "processing", "sending", "sent", "delivered", "opened", "clicked",
    "soft_bounce", "hard_bounce", "bounced", "complained", "failed", "skipped", "cancelled",
  ]);
  const filter = allowed.has(status) ? status : "";
  const rows = (await query(
    `SELECT message.id, message.recipient, message.status,
            message.provider_message_id, message.attempt_count,
            message.failure_reason, message.suppression_reason,
            message.sent_at, message.delivered_at, message.opened_at,
            message.clicked_at, message.updated_at
     FROM contact_campaign_messages message
     JOIN contact_campaigns campaign ON campaign.id = message.campaign_id
     WHERE message.campaign_id = $1::uuid AND campaign.user_id = $2::uuid
       AND ($3 = '' OR message.status = $3)
     ORDER BY message.created_at, message.id
     LIMIT $4 OFFSET $5`,
    [campaignId, userId, filter, pageSize, (page - 1) * pageSize],
  )).rows;
  const totals = await query(
    `SELECT COUNT(*)::int AS total
     FROM contact_campaign_messages message
     JOIN contact_campaigns campaign ON campaign.id = message.campaign_id
     WHERE message.campaign_id = $1::uuid AND campaign.user_id = $2::uuid
       AND ($3 = '' OR message.status = $3)`,
    [campaignId, userId, filter],
  );
  return {
    rows,
    page,
    pageSize,
    total: asNumber((totals.rows[0] as DatabaseRow | undefined)?.total),
    status: filter || "all",
  };
}

export async function archiveContactCampaign(
  userId: string,
  campaignId: string,
) {
  const result = await query(
    `UPDATE contact_campaigns
     SET status = 'archived', archived_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status IN ('sent', 'cancelled')
     RETURNING id`,
    [campaignId, userId],
  );
  if (!result.rows[0]) {
    throw new DataError("Only a finished campaign can be archived.");
  }
  return true;
}

export async function deleteContactCampaign(
  userId: string,
  campaignId: string,
) {
  const owned = await query<{ id: string }>(
    `SELECT id
     FROM contact_campaigns
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [campaignId, userId],
  );
  if (!owned.rows[0]) {
    throw new DataError("That campaign is not available.");
  }

  // Stop future waves and queued retries before the cascade removes the
  // campaign. A provider request already in flight cannot be recalled, but
  // pending campaign work is cancelled at the source.
  await cancelCampaignDelivery(userId, [campaignId]);
  const result = await query(
    `DELETE FROM contact_campaigns
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [campaignId, userId],
  );
  if (!result.rowCount) {
    throw new DataError("That campaign could not be deleted.");
  }
  return true;
}

/**
 * Cancels work that could otherwise outlive a campaign deletion. Sent
 * messages and provider-accepted email logs remain untouched; deletion of the
 * campaign itself cascades its campaign analytics and recipient history.
 */
async function cancelCampaignDelivery(userId: string, campaignIds: string[]) {
  if (!campaignIds.length) return;
  await query(
    `UPDATE contact_campaigns
     SET status = 'cancelled', updated_at = NOW()
     WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, campaignIds],
  );
  await query(
    `UPDATE campaign_send_batches
     SET status = 'cancelled', updated_at = NOW()
     WHERE campaign_id = ANY($1::uuid[])
       AND status IN ('pending', 'sending', 'paused')`,
    [campaignIds],
  );
  await query(
    `UPDATE contact_campaign_messages
     SET status = 'cancelled', updated_at = NOW()
     WHERE campaign_id = ANY($1::uuid[])
       AND status IN ('queued', 'processing', 'sending')`,
    [campaignIds],
  );
  await query(
    `UPDATE email_logs
     SET status = 'skipped',
         last_error = 'Campaign deleted before delivery.',
         updated_at = NOW()
     WHERE user_id = $1
       AND module = 'contacts'
       AND source_event_id = ANY($2::uuid[])
       AND status IN ('queued', 'sending')`,
    [userId, campaignIds],
  );
}

export type ContactCampaignBulkAction = "archive" | "delete" | "pause" | "resume";

export async function bulkUpdateContactCampaigns(
  userId: string,
  campaignIds: string[],
  action: ContactCampaignBulkAction,
) {
  const ids = Array.from(
    new Set(
      (Array.isArray(campaignIds) ? campaignIds : [])
        .map((value) => String(value || "").trim())
        .filter(isUuidValue),
    ),
  ).slice(0, 500);
  if (!ids.length) throw new DataError("Select at least one campaign.");
  if (!("archive delete pause resume".split(" ").includes(action))) {
    throw new DataError("Choose a valid campaign bulk action.");
  }

  type BulkResult = {
    id: string;
    status: "updated" | "skipped";
    reason?: string;
  };

  // Archive and delete are set-based operations, so large selections do not
  // create one database round trip per campaign.
  if (action === "archive") {
    const changed = await query<{ id: string }>(
      `UPDATE contact_campaigns
       SET status = 'archived', archived_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND id = ANY($2::uuid[])
         AND status IN ('sent', 'cancelled')
       RETURNING id`,
      [userId, ids],
    );
    const changedIds = new Set(changed.rows.map((row) => row.id));
    const results: BulkResult[] = ids.map((id) =>
      changedIds.has(id)
        ? { id, status: "updated" }
        : {
            id,
            status: "skipped",
            reason: "Only finished campaigns can be archived.",
          },
    );
    return {
      action,
      requested: ids.length,
      updated: changedIds.size,
      skipped: ids.length - changedIds.size,
      results,
    };
  }

  if (action === "delete") {
    const owned = await query<{ id: string }>(
      `SELECT id
       FROM contact_campaigns
       WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, ids],
    );
    const ownedIds = owned.rows.map((row) => row.id);
    await cancelCampaignDelivery(userId, ownedIds);
    const deleted = ownedIds.length
      ? await query<{ id: string }>(
          `DELETE FROM contact_campaigns
           WHERE user_id = $1 AND id = ANY($2::uuid[])
           RETURNING id`,
          [userId, ownedIds],
        )
      : { rows: [], rowCount: 0 };
    const deletedIds = new Set(deleted.rows.map((row) => row.id));
    const results: BulkResult[] = ids.map((id) =>
      deletedIds.has(id)
        ? { id, status: "updated" }
        : {
            id,
            status: "skipped",
            reason: "That campaign is not available.",
          },
    );
    return {
      action,
      requested: ids.length,
      updated: deletedIds.size,
      skipped: ids.length - deletedIds.size,
      results,
    };
  }

  const results: BulkResult[] = [];
  for (const id of ids) {
    try {
      if (action === "pause") await pauseContactCampaign(userId, id);
      else await resumeContactCampaign(userId, id);
      results.push({ id, status: "updated" });
    } catch (error) {
      results.push({
        id,
        status: "skipped",
        reason:
          error instanceof DataError
            ? error.message
            : "This campaign could not be updated.",
      });
    }
  }
  const updated = results.filter((result) => result.status === "updated").length;
  return {
    action,
    requested: ids.length,
    updated,
    skipped: ids.length - updated,
    results,
  };
}

/**
 * Sends the campaign's own composed HTML to one address. It goes through the
 * same provider path a real send uses, so what lands in the test inbox is what
 * recipients will get — not a stand-in template.
 */
export async function sendCampaignTest(
  userId: string,
  campaignId: string,
  recipient: string,
) {
  const result = await query(
    `SELECT name, subject, html_body, identity_id
     FROM contact_campaigns
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [campaignId, userId],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row) throw new DataError("That campaign is not available.");
  const html = asString(row.html_body).trim();
  if (!html) {
    throw new DataError("Add content to this campaign before sending a test.");
  }
  const { sendEmailNow } = await import("./email-service");
  const settings = await getCampaignSettings(userId);
  try {
    const sent = await sendEmailNow({
      userId,
      to: recipient,
      identityId: row.identity_id
        ? asString(row.identity_id)
        : settings.identityId,
      idempotencyKey: `campaign-test-${campaignId}-${Date.now()}`,
      override: {
        module: "contacts",
        subject: `[Test] ${asString(row.subject)}`,
        html,
      },
      variables: {
        contact: { name: "Test recipient", company: "Test company" },
        unsubscribe: { url: "https://example.com/unsubscribe-preview" },
      },
    });

    // Provider acceptance is awaited in this request. A temporary provider
    // failure is returned to the sender now and never becomes a hidden retry.
    return {
      status: sent.status,
      provider: asString("provider" in sent ? sent.provider : ""),
    };
  } catch (error) {
    const providerStatus = Number(
      (error as { status?: unknown } | null)?.status,
    );
    throw new DataError(
      error instanceof Error
        ? error.message
        : "The provider did not accept this test message.",
      Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus < 600
        ? providerStatus
        : 502,
      "campaign_test_failed",
    );
  }
}

export async function getCampaignAnalytics(
  userId: string,
  campaignId: string,
) {
  const campaignResult = await query(
    `${campaignSelect}
     WHERE campaign.id = $1 AND campaign.user_id = $2
     LIMIT 1`,
    [campaignId, userId],
  );
  const campaignRow = campaignResult.rows[0] as DatabaseRow | undefined;
  if (!campaignRow) throw new DataError("That campaign is not available.");

  const totals = await query(
    `SELECT COALESCE(metric.recipient_count, 0)::int AS recipients,
            COALESCE(metric.sent_count, 0)::int AS sent,
            COALESCE(metric.delivered_count, 0)::int AS delivered,
            COALESCE(metric.unique_open_count, 0)::int AS unique_opens,
            COALESCE(metric.total_open_count, 0)::int AS total_opens,
            COALESCE(metric.unique_click_count, 0)::int AS unique_clicks,
            COALESCE(metric.total_click_count, 0)::int AS total_clicks,
            COALESCE(metric.bounced_count, 0)::int AS bounced,
            COALESCE(metric.complaint_count, 0)::int AS complained,
            COALESCE(metric.failed_count, 0)::int AS failed,
            COALESCE(metric.pending_count, 0)::int AS queued,
            COALESCE(metric.unsubscribe_count, 0)::int AS unsubscribed,
            COALESCE(metric.machine_open_count, 0)::int AS machine_opens,
            COALESCE(metric.human_open_count, 0)::int AS human_opens,
            COALESCE(metric.conversion_count, 0)::int AS conversions,
            COALESCE(metric.revenue_amount, 0)::numeric AS revenue,
            COALESCE(metric.revenue_currency, 'USD') AS revenue_currency,
            COALESCE(metric.realtime_version, 0)::bigint AS realtime_version,
            metric.updated_at::text AS updated_at
     FROM contact_campaigns campaign
     LEFT JOIN campaign_metrics metric
       ON metric.campaign_id = campaign.id
      AND metric.workspace_id = campaign.user_id
     WHERE campaign.id = $1::uuid AND campaign.user_id = $2::uuid
     LIMIT 1`,
    [campaignId, userId],
  );
  const totalsRow = (totals.rows[0] || {}) as DatabaseRow;

  const [breakdowns, timeline, hourly, links, variants] = await Promise.all([
    query(
      `SELECT dimension, dimension_key, label, total_count, unique_count
       FROM campaign_metric_breakdowns
       WHERE workspace_id = $1::uuid AND campaign_id = $2::uuid
       ORDER BY dimension, total_count DESC, label
       LIMIT 120`,
      [userId, campaignId],
    ),
    query(
      `SELECT metric_date::text AS metric_date, sent_count, delivered_count,
              total_open_count, unique_open_count, total_click_count,
              unique_click_count, bounced_count, failed_count,
              unsubscribe_count, complaint_count, conversion_count,
              revenue_amount, revenue_currency
       FROM campaign_daily_metrics
       WHERE workspace_id = $1::uuid AND campaign_id = $2::uuid
       ORDER BY metric_date`,
      [userId, campaignId],
    ),
    query(
      `SELECT metric_hour::text AS metric_hour, sent_count, delivered_count,
              total_open_count, unique_open_count, total_click_count,
              unique_click_count, bounced_count, failed_count,
              unsubscribe_count, complaint_count
       FROM campaign_hourly_metrics
       WHERE workspace_id = $1::uuid AND campaign_id = $2::uuid
       ORDER BY metric_hour`,
      [userId, campaignId],
    ),
    query(
      `SELECT block_id, label, url, click_count, unique_click_count
       FROM contact_campaign_links
       WHERE campaign_id = $1::uuid
       ORDER BY click_count DESC, label`,
      [campaignId],
    ),
    query(
      `SELECT * FROM contact_campaign_variants
       WHERE campaign_id = $1 ORDER BY label`,
      [campaignId],
    ),
  ]);

  const breakdownList = (dimension: string) =>
    breakdowns.rows
      .filter((raw) => asString((raw as DatabaseRow).dimension) === dimension)
      .map((raw) => {
        const row = raw as DatabaseRow;
        return {
          name: asString(row.label || row.dimension_key) || "unknown",
          count: asNumber(row.total_count),
          uniqueCount: asNumber(row.unique_count),
        };
      });
  const sent = asNumber(totalsRow.sent);
  const delivered = asNumber(totalsRow.delivered);
  const uniqueOpens = asNumber(totalsRow.unique_opens);
  const uniqueClicks = asNumber(totalsRow.unique_clicks);
  const engagementBase = delivered || sent;
  const percent = (value: number, denominator: number) =>
    denominator > 0 ? Number(((value / denominator) * 100).toFixed(2)) : 0;

  return {
    campaign: mapCampaign(campaignRow),
    totals: {
      recipients: asNumber(totalsRow.recipients),
      sent,
      delivered,
      uniqueOpens,
      totalOpens: asNumber(totalsRow.total_opens),
      uniqueClicks,
      totalClicks: asNumber(totalsRow.total_clicks),
      bounced: asNumber(totalsRow.bounced),
      complained: asNumber(totalsRow.complained),
      failed: asNumber(totalsRow.failed),
      queued: asNumber(totalsRow.queued),
      unsubscribed: asNumber(totalsRow.unsubscribed),
      machineOpens: asNumber(totalsRow.machine_opens),
      humanOpens: asNumber(totalsRow.human_opens),
    },
    overview: {
      sent,
      delivered,
      deliveryRate: percent(delivered, sent),
      opens: asNumber(totalsRow.total_opens),
      uniqueOpens,
      openRate: percent(uniqueOpens, engagementBase),
      clicks: asNumber(totalsRow.total_clicks),
      uniqueClicks,
      clickRate: percent(uniqueClicks, engagementBase),
      bounceRate: percent(asNumber(totalsRow.bounced), sent),
      unsubscribeRate: percent(asNumber(totalsRow.unsubscribed), sent),
      complaintRate: percent(asNumber(totalsRow.complained), sent),
    },
    delivery: {
      sent,
      delivered,
      bounced: asNumber(totalsRow.bounced),
      failed: asNumber(totalsRow.failed),
      pending: asNumber(totalsRow.queued),
      deliveryRate: percent(delivered, sent),
      bounceRate: percent(asNumber(totalsRow.bounced), sent),
      failureRate: percent(asNumber(totalsRow.failed), sent),
    },
    engagement: {
      totalOpens: asNumber(totalsRow.total_opens),
      uniqueOpens,
      totalClicks: asNumber(totalsRow.total_clicks),
      uniqueClicks,
      machineOpens: asNumber(totalsRow.machine_opens),
      humanOpens: asNumber(totalsRow.human_opens),
      openRate: percent(uniqueOpens, engagementBase),
      clickRate: percent(uniqueClicks, engagementBase),
    },
    devices: breakdownList("device"),
    clients: breakdownList("client").slice(0, 8),
    locations: breakdownList("country"),
    links: links.rows.map((raw) => {
      const row = raw as DatabaseRow;
      return {
        blockId: asString(row.block_id),
        label: asString(row.label),
        url: asString(row.url),
        clickCount: asNumber(row.click_count),
        uniqueClickCount: asNumber(row.unique_click_count),
      };
    }),
    timeline: timeline.rows.map((raw) => {
      const row = raw as DatabaseRow;
      return {
        date: asString(row.metric_date),
        sent: asNumber(row.sent_count),
        delivered: asNumber(row.delivered_count),
        opens: asNumber(row.total_open_count),
        uniqueOpens: asNumber(row.unique_open_count),
        clicks: asNumber(row.total_click_count),
        uniqueClicks: asNumber(row.unique_click_count),
        conversions: asNumber(row.conversion_count),
        revenue: asNumber(row.revenue_amount),
        currency: asString(row.revenue_currency) || "USD",
      };
    }),
    hourly: hourly.rows.map((raw) => {
      const row = raw as DatabaseRow;
      return {
        hour: asString(row.metric_hour),
        sent: asNumber(row.sent_count),
        delivered: asNumber(row.delivered_count),
        opens: asNumber(row.total_open_count),
        uniqueOpens: asNumber(row.unique_open_count),
        clicks: asNumber(row.total_click_count),
        uniqueClicks: asNumber(row.unique_click_count),
      };
    }),
    revenue: {
      orders: asNumber(totalsRow.conversions),
      amount: asNumber(totalsRow.revenue),
      currency: asString(totalsRow.revenue_currency) || "USD",
    },
    variants: variants.rows.map((raw) => mapCampaignVariant(raw as DatabaseRow)),
    realtime: {
      version: asNumber(totalsRow.realtime_version),
      updatedAt: asString(totalsRow.updated_at),
    },
  };
}

export async function getCampaignClickMap(userId: string, campaignId: string) {
  const owned = await query(
    `SELECT id FROM contact_campaigns
     WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [campaignId, userId],
  );
  if (!owned.rows[0]) throw new DataError("That campaign is not available.");
  const result = await query(
     `SELECT link.block_id, link.label, link.url,
            link.click_count, link.unique_click_count
     FROM contact_campaign_links link
     WHERE link.campaign_id = $1::uuid
     ORDER BY click_count DESC, link.label`,
    [campaignId],
  );
  return result.rows.map((raw) => {
    const row = raw as DatabaseRow;
    return {
      blockId: asString(row.block_id),
      label: asString(row.label),
      url: asString(row.url),
      clickCount: asNumber(row.click_count),
      uniqueClickCount: asNumber(row.unique_click_count),
    };
  });
}

/**
 * Cross-campaign comparison. This is also what makes the AI Creator's
 * send-time suggestion data-driven: it reads the workspace's own open hours
 * rather than a generic best-practice default.
 */
export type CampaignOverviewRange = "7d" | "1w" | "1m" | "3m" | "6m" | "1y";

const campaignOverviewRangeDays: Record<CampaignOverviewRange, number> = {
  "7d": 7,
  "1w": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
};

const normalizeCampaignOverviewRange = (
  value: unknown,
): { key: CampaignOverviewRange; days: number } => {
  const key = String(value || "7d") as CampaignOverviewRange;
  return key in campaignOverviewRangeDays
    ? { key, days: campaignOverviewRangeDays[key] }
    : { key: "7d", days: campaignOverviewRangeDays["7d"] };
};

export async function getCampaignPerformanceOverview(
  userId: string,
  range?: CampaignOverviewRange,
) {
  const selectedRange = normalizeCampaignOverviewRange(range);
  const cutoff = new Date(
    Date.now() - selectedRange.days * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const [trend, subjects, hours, upcoming, activeUnsubscribes] = await Promise.all([
    query(
      `SELECT TO_CHAR(
                COALESCE(campaign.sent_at, campaign.scheduled_at, campaign.updated_at)::date,
                'YYYY-MM-DD'
              ) AS date,
              SUM(metric.sent_count)::int AS sent,
              SUM(metric.unique_open_count)::int AS opened,
              SUM(metric.unique_click_count)::int AS clicked
       FROM contact_campaigns campaign
       JOIN campaign_metrics metric
         ON metric.campaign_id = campaign.id
        AND metric.workspace_id = campaign.user_id
       WHERE campaign.user_id = $1::uuid
         AND campaign.status IN ('sent', 'sending', 'archived')
         AND metric.sent_count > 0
          AND COALESCE(campaign.sent_at, campaign.scheduled_at, campaign.updated_at)
                > $2::timestamptz
        GROUP BY COALESCE(campaign.sent_at, campaign.scheduled_at, campaign.updated_at)::date
        ORDER BY 1`,
       [userId, cutoff],
    ),
    query(
      `SELECT campaign.id, campaign.name, campaign.subject,
              metric.sent_count AS sent,
              metric.unique_open_count AS opened,
              metric.unique_click_count AS clicked
       FROM contact_campaigns campaign
       JOIN campaign_metrics metric
         ON metric.campaign_id = campaign.id
        AND metric.workspace_id = campaign.user_id
        WHERE campaign.user_id = $1
          AND campaign.status IN ('sent', 'sending', 'archived')
          AND metric.sent_count > 0
          AND COALESCE(campaign.sent_at, campaign.scheduled_at, campaign.updated_at)
                > $2::timestamptz
        ORDER BY metric.unique_open_count::numeric
                 / GREATEST(metric.sent_count, 1) DESC
        LIMIT 10`,
       [userId, cutoff],
    ),
    query(
      `SELECT EXTRACT(HOUR FROM metric.metric_hour)::int AS hour,
               SUM(metric.total_open_count)::int AS opens
        FROM campaign_hourly_metrics metric
        WHERE metric.workspace_id = $1::uuid
          AND metric.metric_hour > $2::timestamptz
        GROUP BY 1
        ORDER BY opens DESC`,
       [userId, cutoff],
    ),
    query(
      `SELECT COUNT(*)::int AS unsubscribe_count
       FROM email_suppressions
       WHERE user_id = $1::uuid
         AND reason = 'unsubscribe'
         AND created_at > $2::timestamptz`,
      [userId, cutoff],
    ),
    query(
      `${campaignSelect}
       WHERE campaign.user_id = $1
         AND campaign.status IN ('scheduled', 'sending', 'paused')
       ORDER BY campaign.scheduled_at
       LIMIT 12`,
      [userId],
    ),
  ]);
  return {
    range: selectedRange.key,
    rangeDays: selectedRange.days,
    // This is the current active unsubscribe state. Historical campaign
    // analytics remain immutable, but removing a suppression should remove
    // that address from this operational Overview count immediately.
    unsubscribes: asNumber(
      (activeUnsubscribes.rows[0] as DatabaseRow | undefined)?.unsubscribe_count,
    ),
    trend: trend.rows.map((raw) => {
      const row = raw as DatabaseRow;
      return {
        date: asString(row.date),
        sent: asNumber(row.sent),
        opened: asNumber(row.opened),
        clicked: asNumber(row.clicked),
      };
    }),
    subjects: subjects.rows.map((raw) => {
      const row = raw as DatabaseRow;
      return {
        campaignId: asString(row.id),
        name: asString(row.name),
        subject: asString(row.subject),
        sent: asNumber(row.sent),
        opened: asNumber(row.opened),
        clicked: asNumber(row.clicked),
      };
    }),
    openHours: hours.rows.map((raw) => {
      const row = raw as DatabaseRow;
      return { hour: asNumber(row.hour), opens: asNumber(row.opens) };
    }),
    upcoming: upcoming.rows.map((raw) => mapCampaign(raw as DatabaseRow)),
  };
}

const mapCampaignVariant = (row: DatabaseRow): CampaignVariant => ({
  id: asString(row.id),
  label: asString(row.label) === "B" ? "B" : "A",
  subject: asString(row.subject),
  previewText: asString(row.preview_text),
  blocks: asJson<unknown[]>(row.blocks, []),
  testPercentage: asNumber(row.test_percentage),
  decisionMetric: asString(row.decision_metric) === "click" ? "click" : "open",
  decisionAfterHours: asNumber(row.decision_after_hours),
  sentCount: asNumber(row.sent_count),
  openedCount: asNumber(row.opened_count),
  clickedCount: asNumber(row.clicked_count),
  winner: asBoolean(row.winner),
});

export async function listCampaignVariants(
  userId: string,
  campaignId: string,
) {
  const result = await query(
    `SELECT variant.*
     FROM contact_campaign_variants variant
     JOIN contact_campaigns campaign ON campaign.id = variant.campaign_id
     WHERE variant.campaign_id = $1 AND campaign.user_id = $2
     ORDER BY variant.label`,
    [campaignId, userId],
  );
  return result.rows.map((raw) => mapCampaignVariant(raw as DatabaseRow));
}

export async function saveCampaignAbTest(
  userId: string,
  campaignId: string,
  input: {
    enabled: boolean;
    testPercentage: number;
    decisionMetric: "open" | "click";
    decisionAfterHours: number;
    variantSubject: string;
    variantPreviewText?: string;
  },
) {
  const owned = await query(
    `SELECT subject, preview_text, blocks
     FROM contact_campaigns
     WHERE id = $1 AND user_id = $2 AND status IN ('draft', 'paused')
     LIMIT 1`,
    [campaignId, userId],
  );
  const row = owned.rows[0] as DatabaseRow | undefined;
  if (!row) {
    throw new DataError("A/B testing can only be configured before a send.");
  }
  if (!input.enabled) {
    await query(
      `DELETE FROM contact_campaign_variants WHERE campaign_id = $1`,
      [campaignId],
    );
    return [] as CampaignVariant[];
  }
  const variantSubject = input.variantSubject.trim();
  if (!variantSubject) {
    throw new DataError("Variant B needs its own subject line to be tested.");
  }
  const percentage = Math.min(
    50,
    Math.max(5, Math.round(Number(input.testPercentage) || 20)),
  );
  const hours = Math.min(
    168,
    Math.max(1, Math.round(Number(input.decisionAfterHours) || 4)),
  );
  const metric = input.decisionMetric === "click" ? "click" : "open";
  const result = await query(
    `INSERT INTO contact_campaign_variants (
       campaign_id, label, subject, preview_text, blocks, test_percentage,
       decision_metric, decision_after_hours, created_at, updated_at
     )
     VALUES
       ($1, 'A', $2, $3, $4::jsonb, $6, $7, $8, NOW(), NOW()),
       ($1, 'B', $5, $3, $4::jsonb, $6, $7, $8, NOW(), NOW())
     ON CONFLICT (campaign_id, label)
     DO UPDATE SET
       subject = EXCLUDED.subject,
       preview_text = EXCLUDED.preview_text,
       test_percentage = EXCLUDED.test_percentage,
       decision_metric = EXCLUDED.decision_metric,
       decision_after_hours = EXCLUDED.decision_after_hours,
       updated_at = NOW()
     RETURNING *`,
    [
      campaignId,
      asString(row.subject),
      input.variantPreviewText?.trim() || asString(row.preview_text),
      JSON.stringify(asJson<unknown[]>(row.blocks, [])),
      variantSubject,
      percentage,
      metric,
      hours,
    ],
  );
  return result.rows
    .map((raw) => mapCampaignVariant(raw as DatabaseRow))
    .sort((first, second) => first.label.localeCompare(second.label));
}

export const defaultCampaignSettings: ContactCampaignSettings = {
  identityId: null,
  mailingAddress: "",
  footerText:
    "You are receiving this because you subscribed to updates from {{workspace.name}}.",
  brandVoice: "friendly",
  batchSize: null,
  batchDelaySeconds: null,
};

/**
 * The postal address the workspace gave during onboarding. Campaign settings
 * fall back to it so the compliance footer is already satisfied rather than
 * blocking someone at the moment they try to send their first campaign.
 */
const onboardingMailingAddress = async (userId: string) => {
  const result = await query(
    `SELECT address_line1, address_line2, city,
            state_region, postal_code, country
     FROM user_onboarding WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row) return "";
  return composeCampaignMailingAddress({
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    stateRegion: row.state_region,
    postalCode: row.postal_code,
    country: row.country,
  });
};

const composeCampaignMailingAddress = (parts: {
  addressLine1?: unknown;
  addressLine2?: unknown;
  city?: unknown;
  stateRegion?: unknown;
  postalCode?: unknown;
  country?: unknown;
}) =>
  [
    asString(parts.addressLine1).trim().slice(0, 200),
    asString(parts.addressLine2).trim().slice(0, 200),
    [
      asString(parts.city).trim().slice(0, 120),
      asString(parts.stateRegion).trim().slice(0, 120),
    ]
      .filter(Boolean)
      .join(", "),
    asString(parts.postalCode).trim().slice(0, 40),
    asString(parts.country).trim().slice(0, 120),
  ]
    .filter(Boolean)
    .join("\n");

/** The General settings business address is the second durable source for
 * campaign compliance when a workspace has not customized Campaign settings. */
const workspaceMailingAddress = async (userId: string) => {
  const result = await query(
    `SELECT address, address_line1, address_line2, city,
            state_region, postal_code, country
     FROM company_settings WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row) return "";
  return (
    composeCampaignMailingAddress({
      addressLine1: row.address_line1,
      addressLine2: row.address_line2,
      city: row.city,
      stateRegion: row.state_region,
      postalCode: row.postal_code,
      country: row.country,
    }) || asString(row.address)
  );
};

export async function getCampaignSettings(userId: string) {
  const result = await query(
    `SELECT * FROM contact_campaign_settings WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  const workspaceAddress = await workspaceMailingAddress(userId);
  const fallbackAddress =
    workspaceAddress || (await onboardingMailingAddress(userId));
  if (!row) {
    return {
      ...defaultCampaignSettings,
      mailingAddress: fallbackAddress,
    };
  }
  return {
    identityId: asString(row.identity_id) || null,
    // General settings owns the physical address. Keep the older campaign
    // value only for workspaces that have not populated a business address.
    mailingAddress: fallbackAddress || asString(row.mailing_address),
    footerText:
      asString(row.footer_text) || defaultCampaignSettings.footerText,
    brandVoice: (asString(row.brand_voice) ||
      "friendly") as ContactCampaignSettings["brandVoice"],
    batchSize: row.batch_size == null ? null : asNumber(row.batch_size),
    batchDelaySeconds:
      row.batch_delay_seconds == null
        ? null
        : asNumber(row.batch_delay_seconds),
  } satisfies ContactCampaignSettings;
}

export async function saveCampaignSettings(
  userId: string,
  settings: ContactCampaignSettings,
) {
  const voice = ["friendly", "direct", "playful", "formal"].includes(
    settings.brandVoice,
  )
    ? settings.brandVoice
    : "friendly";
  // Null means "keep the provider-derived default". A stored override is still
  // re-clamped against the provider's real rate at plan time, so a value here
  // can slow a send down but never push it past what the provider accepts.
  const boundedOverride = (
    value: unknown,
    minimum: number,
    maximum: number,
  ) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return null;
    return Math.min(maximum, Math.max(minimum, parsed));
  };
  await query(
    `INSERT INTO contact_campaign_settings (
       user_id, identity_id, mailing_address, footer_text, brand_voice, batch_size,
       batch_delay_seconds, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       identity_id = EXCLUDED.identity_id,
       mailing_address = EXCLUDED.mailing_address,
       footer_text = EXCLUDED.footer_text,
       brand_voice = EXCLUDED.brand_voice,
       batch_size = EXCLUDED.batch_size,
       batch_delay_seconds = EXCLUDED.batch_delay_seconds,
       updated_at = NOW()`,
    [
      userId,
      settings.identityId || null,
      settings.mailingAddress.trim().slice(0, 400),
      settings.footerText.trim().slice(0, 600),
      voice,
      boundedOverride(settings.batchSize, 1, 5_000),
      boundedOverride(settings.batchDelaySeconds, 0, 3_600),
    ],
  );
  return getCampaignSettings(userId);
}

/* ------------------------------------------------------------------ *
 * Campaigns v2: the full-screen builder and the send wizard.
 *
 * The builder autosaves design work; Save & Continue marks the campaign
 * ready and hands it to the wizard, which collects recipients, sender
 * identity and timing as ordered steps against the same campaign row.
 * ------------------------------------------------------------------ */

const requireEditableCampaign = async (userId: string, campaignId: string) => {
  const result = await query(
    `SELECT campaign.*,
            EXISTS (
              SELECT 1
              FROM campaign_send_batches batch
              WHERE batch.campaign_id = campaign.id
                AND batch.dispatched_at IS NOT NULL
            ) AS send_started,
            EXISTS (
              SELECT 1
              FROM contact_campaign_messages message
              WHERE message.campaign_id = campaign.id
                AND message.sent_at IS NOT NULL
            ) AS message_started,
            (
              campaign.status = 'scheduled'
              AND campaign.scheduled_at IS NOT NULL
              AND campaign.scheduled_at <= NOW()
            ) AS due_now
     FROM contact_campaigns campaign
     WHERE campaign.id = $1 AND campaign.user_id = $2 LIMIT 1`,
    [campaignId, userId],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row) throw new DataError("That campaign is not available.", 404);
  const preSend =
    ["scheduled", "paused"].includes(asString(row.status)) &&
    !asBoolean(row.send_started) &&
    !asBoolean(row.message_started) &&
    !row.sent_at &&
    !asBoolean(row.due_now);
  if (asString(row.status) !== "draft" && !preSend) {
    throw new DataError(
      "Only a campaign that has not started sending can be edited. Duplicate a sent or in-progress campaign to reuse it.",
    );
  }
  return row;
};

/**
 * Autosave from the full-screen builder. Only design surface is written here:
 * audience and timing belong to the wizard, so an in-progress design can never
 * silently change who a campaign is addressed to.
 */
export async function saveCampaignBuilderState(
  userId: string,
  campaignId: string,
  input: {
    name?: string;
    subject?: string;
    previewText?: string;
    htmlBody?: string;
    blocks?: unknown[];
    category?: string;
    spamScore?: number | null;
  },
) {
  await requireEditableCampaign(userId, campaignId);
  const blocks = input.blocks === undefined ? null : campaignBlocks(input.blocks);
  const result = await query(
    `UPDATE contact_campaigns
     SET name = COALESCE(NULLIF(TRIM($3), ''), name),
         subject = COALESCE($4, subject),
         preview_text = COALESCE($5, preview_text),
         html_body = COALESCE($6, html_body),
         blocks = COALESCE($7::jsonb, blocks),
         category = COALESCE(NULLIF(TRIM($8), ''), category),
         spam_score = COALESCE($9, spam_score),
         builder_state = 'draft',
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, updated_at`,
    [
      campaignId,
      userId,
      asString(input.name).slice(0, 200),
      input.subject === undefined ? null : asString(input.subject).slice(0, 300),
      input.previewText === undefined
        ? null
        : asString(input.previewText).slice(0, 300),
      input.htmlBody === undefined ? null : asString(input.htmlBody),
      blocks === null ? null : JSON.stringify(blocks),
      asString(input.category).slice(0, 40),
      input.spamScore === undefined || input.spamScore === null
        ? null
        : Number(input.spamScore),
    ],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row) throw new DataError("That campaign is not available.", 404);
  if (blocks) await syncCampaignLinks(campaignId, blocks);
  return { savedAt: asString(row.updated_at) };
}

/**
 * Save & Continue. Finishing the design is what advances the flow, so this is
 * the only gate between the builder and the wizard — there is no separate
 * publish step hidden in a settings tab.
 */
export async function completeCampaignBuilder(
  userId: string,
  campaignId: string,
) {
  const campaign = await requireEditableCampaign(userId, campaignId);
  if (!asString(campaign.subject).trim()) {
    throw new DataError("Add a subject line before continuing.");
  }
  if (!asString(campaign.html_body).trim()) {
    throw new DataError("Add some content before continuing.");
  }
  await query(
    `UPDATE contact_campaigns
     SET builder_state = 'ready_to_send', updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [campaignId, userId],
  );
  return { builderState: "ready_to_send" as const };
}

/** Wizard step 1. Stores the audience and returns the live deliverable count. */
export async function saveCampaignWizardRecipients(
  userId: string,
  campaignId: string,
  input: {
    audienceMode?: CampaignAudienceMode;
    listIds?: string[];
    listId?: string;
    excludeListId?: string | null;
    customRecipients?: string[];
  },
) {
  await requireEditableCampaign(userId, campaignId);
  const selectedAudience = normalizeCampaignAudience(input);
  await assertCustomAudienceIsEligible(userId, selectedAudience);
  if (selectedAudience.audienceMode === "lists") {
    const owned = await query(
      `SELECT id FROM contact_lists
       WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, selectedAudience.listIds],
    );
    if (owned.rowCount !== selectedAudience.listIds.length) {
      throw new DataError("One of the selected audiences is not available.", 404);
    }
  }
  const excludeListId =
    selectedAudience.audienceMode === "lists" && input.excludeListId
      ? await requireOwnedList(userId, input.excludeListId)
      : null;
  if (excludeListId && selectedAudience.listIds.includes(excludeListId)) {
    throw new DataError(
      "An exclusion list has to be different from every selected audience.",
    );
  }
  await query(
    `UPDATE contact_campaigns
     SET list_id = $3, exclude_list_id = $4, audience_mode = $5,
         audience_list_ids = $6::jsonb, custom_recipients = $7::jsonb,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [
      campaignId,
      userId,
      selectedAudience.listIds[0] || null,
      excludeListId,
      selectedAudience.audienceMode,
      JSON.stringify(selectedAudience.listIds),
      JSON.stringify(selectedAudience.customRecipients),
    ],
  );
  const audience = await getCampaignAudiencePreview(userId, {
    audienceMode: selectedAudience.audienceMode,
    listIds: selectedAudience.listIds,
    excludeListId,
    customRecipients: selectedAudience.customRecipients,
  });
  const pacing = await previewCampaignPacing(
    userId,
    campaignId,
    audience.deliverable,
  );
  return {
    audience,
    pacing: {
      ...pacing,
      summary: describeSendDuration(pacing.estimatedDurationSeconds),
    },
  };
}

/** Wizard step 2. Sender identity is owned by Email settings, not campaigns. */
export async function saveCampaignWizardIdentity(
  userId: string,
  campaignId: string,
  input: {
    identityId?: string | null;
  },
) {
  await requireEditableCampaign(userId, campaignId);
  let identityId = asString(input.identityId) || "";

  if (!identityId) {
    const settings = await getCampaignSettings(userId);
    identityId = settings.identityId || "";
    if (!identityId) {
      const fallback = await query(
        `SELECT id FROM email_identities WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
        [userId],
      );
      identityId = asString((fallback.rows[0] as DatabaseRow | undefined)?.id);
    }
    if (!identityId) {
      throw new DataError(
        "Set your sender identity in Email settings before sending campaigns.",
      );
    }
  } else {
    const owned = await query(
      `SELECT id FROM email_identities WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [identityId, userId],
    );
    if (!owned.rows[0]) {
      throw new DataError("That sender identity is not available.", 404);
    }
  }

  await query(
    `UPDATE contact_campaigns
     SET identity_id = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [campaignId, userId, identityId],
  );
  return getCampaignWizardIdentities(userId, campaignId);
}

/** The identities this workspace can send from, plus the campaign's choice. */
export async function getCampaignWizardIdentities(
  userId: string,
  campaignId: string,
) {
  const [identities, campaign, settings, activeDelivery, verifiedDomains] = await Promise.all([
    query(
      `SELECT id, sender_name, sender_email, reply_to, sending_mode,
              sender_prefix, managed_domain, generated_sender_email,
              managed_sender_email, custom_sender_email, custom_domain,
              domain_verified, domain_verification_status
       FROM email_identities WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId],
    ),
    query(
      `SELECT identity_id FROM contact_campaigns
       WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [campaignId, userId],
    ),
    getCampaignSettings(userId),
    getWorkspaceEmailDeliveryState(userId),
    query(
      `SELECT domain_record.domain
       FROM email_sending_domains domain_record
       JOIN email_provider_connections connection ON connection.id = domain_record.provider_connection_id
       WHERE domain_record.user_id = $1 AND domain_record.status = 'verified'
         AND connection.role = 'primary' AND connection.status = 'connected' AND connection.health_ok = TRUE`,
      [userId],
    ),
  ]);
  const currentProvider = activeDelivery?.provider || "";
  const currentMode = activeDelivery?.mode || "";
  const deliveryReady = activeDelivery?.ready === true;
  const verifiedDomainSet = new Set(verifiedDomains.rows.map((row) => asString((row as DatabaseRow).domain).toLowerCase()));
  const selected =
    asString((campaign.rows[0] as DatabaseRow | undefined)?.identity_id) ||
    settings.identityId ||
    asString((identities.rows[0] as DatabaseRow | undefined)?.id) ||
    null;
  return {
    selectedIdentityId: selected,
    identities: identities.rows.map((value) => {
      const row = value as DatabaseRow;
      const sendingMode = asString(row.sending_mode) === "custom" ? "custom" : "managed";
      const managedSender = managedSenderForCampaign(row);
      const customSender = asString(row.custom_sender_email) || (sendingMode === "custom" ? asString(row.sender_email) : "");
      const senderEmail = sendingMode === "custom" ? customSender : managedSender;
      const senderReady = Boolean(senderEmail && deliveryReady && (
        sendingMode === "managed"
          ? currentMode === "managed" && currentProvider === "resend"
          : currentMode === "custom" && row.domain_verified === true && Boolean(currentProvider) && verifiedDomainSet.has(asString(row.custom_domain).toLowerCase())
      ));
      return {
        id: asString(row.id),
        senderName: asString(row.sender_name),
        senderEmail,
        replyTo: asString(row.reply_to),
        sendingMode,
        customDomain: asString(row.custom_domain),
        domainVerified: row.domain_verified === true,
        domainVerificationStatus: asString(row.domain_verification_status) || (sendingMode === "managed" ? "not_required" : "pending"),
        senderReady,
        verified: senderReady,
      };
    }),
  };
}

/** Wizard step 3. Everything needed to confirm a send, on one screen. */
export async function getCampaignWizardReview(
  userId: string,
  campaignId: string,
) {
  const result = await query(
    `${campaignSelect}
     WHERE campaign.id = $1 AND campaign.user_id = $2
     LIMIT 1`,
    [campaignId, userId],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row) throw new DataError("That campaign is not available.", 404);

  const [identities, settings] = await Promise.all([
    getCampaignWizardIdentities(userId, campaignId),
    getCampaignSettings(userId),
  ]);
  const storedListIds = normalizeCampaignListIds(
    asJson<unknown[]>(row.audience_list_ids, []),
    row.list_id,
  );
  const storedCustomRecipients = normalizeCampaignRecipients(
    asJson<unknown[]>(row.custom_recipients, []),
  );
  const storedAudienceMode: CampaignAudienceMode =
    asString(row.audience_mode) === "custom" ? "custom" : "lists";
  const hasAudience =
    storedAudienceMode === "custom"
      ? storedCustomRecipients.length > 0
      : storedListIds.length > 0;
  const audience = hasAudience
    ? await getCampaignAudiencePreview(userId, {
        audienceMode: storedAudienceMode,
        listIds: storedListIds,
        excludeListId: asString(row.exclude_list_id) || null,
        customRecipients: storedCustomRecipients,
      })
    : null;
  const pacing = await previewCampaignPacing(
    userId,
    campaignId,
    audience?.deliverable || 0,
  );
  const identity =
    identities.identities.find(
      (value) => value.id === identities.selectedIdentityId,
    ) || null;

  // Everything that would block a send, surfaced before the user commits.
  const blockers: string[] = [];
  if (!asString(row.subject).trim()) blockers.push("Add a subject line.");
  if (!asString(row.html_body).trim()) blockers.push("Add campaign content.");
  if (!audience) blockers.push("Choose who should receive this campaign.");
  if (audience && !audience.deliverable) {
    blockers.push(
      "No contact in this audience can currently receive email.",
    );
  }
  if (!identity) blockers.push("Add the sender this campaign comes from.");
  if (identity && !identity.senderReady) {
    blockers.push(
      identity.sendingMode === "custom"
        ? "Verify the custom sending domain in Email settings before sending."
        : "Finish MaxForm Managed Sending setup in Email settings before sending.",
    );
  }
  if (!settings.mailingAddress.trim()) {
    blockers.push(
      "Add your physical mailing address in Campaigns settings. Marketing email is required to carry one.",
    );
  }
  if (!campaignSendAllowed()) {
    blockers.push(
      "Campaign sending is not enabled for this environment. Set a stable HTTPS PUBLIC_APP_URL in production, or explicitly enable development sending for a local smoke test.",
    );
  }

  return {
    campaign: mapCampaign(row),
    audience,
    identity,
    pacing: {
      ...pacing,
      summary: describeSendDuration(pacing.estimatedDurationSeconds),
    },
    settings,
    blockers,
    canSend: blockers.length === 0,
  };
}

/** Wizard steps 4 and 5: timing, then the committing action. */
export async function scheduleCampaignFromWizard(
  userId: string,
  campaignId: string,
  input: {
    strategy?: string;
    scheduledAt?: string;
    recurrenceRule?: string;
    recurrenceRequiresReview?: boolean;
  },
) {
  const review = await getCampaignWizardReview(userId, campaignId);
  if (!review.canSend) {
    throw new DataError(review.blockers[0]);
  }
  const strategy = asString(input.strategy) || "immediate";
  if (strategy === "immediate") {
    const queued = await sendContactCampaignNow(userId, campaignId);
    return { queued, strategy, scheduledAt: null as string | null };
  }
  const scheduledAt = asString(input.scheduledAt);
  const queued = await scheduleContactCampaign(userId, campaignId, scheduledAt, {
    sendStrategy: strategy,
    recurrenceRule: input.recurrenceRule,
    recurrenceRequiresReview: input.recurrenceRequiresReview,
  });
  return { queued, strategy, scheduledAt };
}

/** Live batch progress for the campaign detail view. */
export async function getContactCampaignSendProgress(
  userId: string,
  campaignId: string,
) {
  const progress = await getCampaignSendProgress(userId, campaignId);
  return {
    ...progress,
    estimatedDurationSummary: describeSendDuration(
      progress.estimatedSendDurationSeconds,
    ),
  };
}

export const defaultContactCrmSettings: ContactCrmSettings = {
  deduplicationMode: "email",
  lifecycleStages: ["lead", "contacted", "customer", "past_customer"],
  unsubscribeFooter:
    "You can unsubscribe from marketing emails at any time.",
};

export async function getContactCrmSettings(userId: string) {
  const result = await query(
    `SELECT deduplication_mode, lifecycle_stages, unsubscribe_footer
     FROM contact_crm_settings
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  if (!result.rows[0]) return defaultContactCrmSettings;
  const row = result.rows[0] as DatabaseRow;
  return {
    deduplicationMode:
      row.deduplication_mode === "email_phone" ? "email_phone" : "email",
    lifecycleStages: asJson<string[]>(
      row.lifecycle_stages,
      defaultContactCrmSettings.lifecycleStages,
    ).map(String),
    unsubscribeFooter:
      asString(row.unsubscribe_footer) ||
      defaultContactCrmSettings.unsubscribeFooter,
  } satisfies ContactCrmSettings;
}

export async function saveContactCrmSettings(
  userId: string,
  settings: ContactCrmSettings,
) {
  const result = await query(
    `INSERT INTO contact_crm_settings (
       user_id, deduplication_mode, lifecycle_stages, unsubscribe_footer,
       created_at, updated_at
     )
     VALUES ($1, $2, $3::jsonb, $4, NOW(), NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       deduplication_mode = EXCLUDED.deduplication_mode,
       lifecycle_stages = EXCLUDED.lifecycle_stages,
       unsubscribe_footer = EXCLUDED.unsubscribe_footer,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      settings.deduplicationMode,
      JSON.stringify(settings.lifecycleStages),
      settings.unsubscribeFooter.trim(),
    ],
  );
  if (!result.rows[0]) throw new Error("CRM settings could not be saved");
  return getContactCrmSettings(userId);
}

export async function importContacts(
  userId: string,
  fileName: string,
  listId: string,
  rows: Array<{
    email: string;
    fullName?: string;
    phone?: string;
    company?: string;
    tags?: string[];
  }>,
) {
  const listResult = await query(
    `SELECT id
     FROM contact_lists
     WHERE id = $1
       AND user_id = $2
       AND list_type = 'static'
     LIMIT 1`,
    [listId, userId],
  );
  if (!listResult.rows[0]) {
    throw new Error("Choose a valid static contact list");
  }

  let importedCount = 0;
  let updatedCount = 0;
  const contactIds: string[] = [];
  const normalized = new Map<
    string,
    {
      email: string;
      full_name: string | null;
      phone: string | null;
      company: string | null;
      tags: string[];
    }
  >();
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    const previous = normalized.get(email);
    normalized.set(email, {
      email,
      full_name: row.fullName?.trim() || previous?.full_name || null,
      phone: row.phone?.trim() || previous?.phone || null,
      company: row.company?.trim() || previous?.company || null,
      tags: Array.from(
        new Set([...(previous?.tags || []), ...(row.tags || [])]),
      ),
    });
  }

  const validRows = Array.from(normalized.values());
  const skippedCount = rows.length - validRows.length;
  for (let index = 0; index < validRows.length; index += 250) {
    const batch = validRows.slice(index, index + 250);
    const result = await query(
      `WITH incoming AS (
         SELECT
           LOWER(BTRIM(record.email)) AS email,
           NULLIF(BTRIM(record.full_name), '') AS full_name,
           NULLIF(BTRIM(record.phone), '') AS phone,
           NULLIF(BTRIM(record.company), '') AS company,
           COALESCE(record.tags, '[]'::jsonb) AS tags
         FROM jsonb_to_recordset($2::jsonb) AS record(
           email TEXT,
           full_name TEXT,
           phone TEXT,
           company TEXT,
           tags JSONB
         )
       ),
       owned_list AS (
         SELECT id
         FROM contact_lists
         WHERE id = $3
           AND user_id = $1
           AND list_type = 'static'
       ),
       upserted AS (
         INSERT INTO contacts (
           email, full_name, phone, company, tags, custom_fields, created_by,
           lifecycle_stage, source_type, last_activity_at, created_at, updated_at
         )
         SELECT
           incoming.email, incoming.full_name, incoming.phone, incoming.company,
           incoming.tags, '{}', $1, 'lead', 'import', NOW(), NOW(), NOW()
         FROM incoming
         WHERE EXISTS (SELECT 1 FROM owned_list)
         ON CONFLICT (created_by, LOWER(email))
         DO UPDATE SET
           full_name = COALESCE(EXCLUDED.full_name, contacts.full_name),
           phone = COALESCE(EXCLUDED.phone, contacts.phone),
           company = COALESCE(EXCLUDED.company, contacts.company),
           tags = contacts.tags || EXCLUDED.tags,
           source_type = CASE
             WHEN contacts.source_type = 'manual' THEN 'import'
             ELSE contacts.source_type
           END,
           updated_at = NOW(),
           last_activity_at = NOW()
         RETURNING id, (xmax = 0) AS inserted
       ),
       attached AS (
         INSERT INTO contact_list_members (
           list_id, contact_id, source_type, source_id, added_at
         )
         SELECT owned_list.id, upserted.id, 'import', NULL, NOW()
         FROM owned_list
         CROSS JOIN upserted
         ON CONFLICT ON CONSTRAINT contact_list_members_pkey DO NOTHING
         RETURNING contact_id
       )
       SELECT upserted.id, upserted.inserted
       FROM upserted
       WHERE (SELECT COUNT(*) FROM attached) >= 0`,
      [
        userId,
        JSON.stringify(batch),
        listId,
      ],
    );
    result.rows.forEach((raw) => {
      const row = raw as DatabaseRow;
      contactIds.push(asString(row.id));
      if (asBoolean(row.inserted)) importedCount += 1;
      else updatedCount += 1;
    });
  }
  await query(
    `INSERT INTO contact_import_jobs (
       user_id, file_name, status, imported_count, updated_count,
       skipped_count, created_at
     )
     VALUES ($1, $2, 'completed', $3, $4, $5, NOW())`,
    [userId, fileName, importedCount, updatedCount, skippedCount],
  );
  return { contactIds, importedCount, updatedCount, skippedCount };
}

const answerText = (answers: Record<string, unknown>, fieldId: string) => {
  const answer = answers[fieldId];
  return Array.isArray(answer)
    ? answer.map(String).join(", ")
    : asString(answer).trim();
};

const inferredField = (
  fields: FormField[],
  predicate: (field: FormField) => boolean,
) => fields.find(predicate)?.id || "";

export async function syncSubmissionContact(
  form: FormRecord,
  submissionId: string,
  answers: Record<string, unknown>,
) {
  const mappingResult = await query(
    `SELECT mapping.*
     FROM form_list_mappings mapping
     JOIN contact_lists list ON list.id = mapping.list_id
     WHERE mapping.form_id = $1 AND list.user_id = $2`,
    [form.id, form.createdBy],
  );
  if (mappingResult.rows.length === 0) return null;

  const first = mappingResult.rows[0] as DatabaseRow;
  const fieldMapping = asJson<Record<string, string>>(first.field_mapping, {});
  const emailFieldId =
    fieldMapping.email ||
    inferredField(form.fields, (field) => field.type === "email");
  const email = answerText(answers, emailFieldId).toLowerCase();
  if (!email) return null;
  const nameFieldId =
    fieldMapping.fullName ||
    inferredField(form.fields, (field) => /name/i.test(field.label));
  const phoneFieldId =
    fieldMapping.phone ||
    inferredField(form.fields, (field) => field.type === "phone");
  const companyFieldId =
    fieldMapping.company ||
    inferredField(form.fields, (field) =>
      /company|organization|organisation/i.test(field.label),
    );
  const standardKeys = new Set(["email", "fullName", "phone", "company"]);
  const customFields = Object.fromEntries(
    Object.entries(fieldMapping)
      .filter(([key]) => !standardKeys.has(key))
      .map(([key, fieldId]) => [key, answerText(answers, fieldId)]),
  );
  const contactResult = await query(
    `INSERT INTO contacts (
       email, full_name, phone, company, tags, custom_fields, created_by,
       lifecycle_stage, source_type, source_id, last_activity_at,
       created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, '[]', $5::jsonb, $6, 'lead', 'form', $7,
       NOW(), NOW(), NOW()
     )
     ON CONFLICT (created_by, LOWER(email))
     DO UPDATE SET
       full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), contacts.full_name),
       phone = COALESCE(NULLIF(EXCLUDED.phone, ''), contacts.phone),
       company = COALESCE(NULLIF(EXCLUDED.company, ''), contacts.company),
       custom_fields = contacts.custom_fields || EXCLUDED.custom_fields,
       source_type = 'form',
       source_id = EXCLUDED.source_id,
       last_activity_at = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [
      email,
      answerText(answers, nameFieldId) || null,
      answerText(answers, phoneFieldId) || null,
      answerText(answers, companyFieldId) || null,
      JSON.stringify(customFields),
      form.createdBy,
      form.id,
    ],
  );
  const contactId = asString((contactResult.rows[0] as DatabaseRow).id);
  const listIds = mappingResult.rows.map((row) =>
    asString((row as DatabaseRow).list_id),
  );
  await addContactsToList(
    form.createdBy,
    listIds[0],
    [contactId],
    "form",
    form.id,
  );
  for (const listId of listIds.slice(1)) {
    await addContactsToList(
      form.createdBy,
      listId,
      [contactId],
      "form",
      form.id,
    );
  }
  await addContactActivity(form.createdBy, contactId, {
    activityType: "form_submitted",
    title: `Submitted ${form.title}`,
    detail: "Contact details were synced from the response",
    entityType: "submission",
    entityId: submissionId,
    metadata: { formId: form.id },
  });
  return contactId;
}

export async function listContactPayments(
  userId: string,
  contactEmail: string,
) {
  const rows = await listSecureContactPayments(userId, contactEmail);
  return rows.map((raw) => {
    const row = raw as DatabaseRow;
    return {
      id: asString(row.id),
      amount: asNumber(row.amount),
      currency: asString(row.currency),
      status: asString(row.status),
      formTitle: asString(row.form_title),
      createdAt: asString(row.created_at),
    };
  });
}


/** Actions that a signed-out visitor may call. */
const PUBLIC_ACTIONS = new Set<string>();

export async function handleContactsData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const action = String(url.searchParams.get("action") || "");
    const userId = PUBLIC_ACTIONS.has(action)
      ? ""
      : await authenticatedUserId(request);
    const payload =
      request.method === "POST"
        ? await readBody(request)
        : ({} as Record<string, unknown>);

    switch (action) {
      case "list-contacts":
        return json(response, 200, {
          result: (await listContacts(userId, payload.options as never)) ?? null,
        });
      case "get-contact":
        return json(response, 200, {
          result: (await getContact(userId, payload.contactId as never)) ?? null,
        });
      case "create-contact":
        return json(response, 200, {
          result: (await createContact(userId, payload.input as never)) ?? null,
        });
      case "update-contact":
        return json(response, 200, {
          result: (await updateContact(userId, payload.contactId as never, payload.input as never)) ?? null,
        });
      case "delete-contacts":
        return json(response, 200, {
          result: (await deleteContacts(userId, payload.contactIds as never)) ?? null,
        });
      case "merge-contacts":
        return json(response, 200, {
          result: (await mergeContacts(userId, payload.winnerContactId as never, payload.mergedContactId as never)) ?? null,
        });
      case "add-contact-activity":
        return json(response, 200, {
          result: (await addContactActivity(userId, payload.contactId as never, payload.input as never)) ?? null,
        });
      case "list-contact-activity":
        return json(response, 200, {
          result: (await listContactActivity(userId, payload.contactId as never)) ?? null,
        });
      case "list-contact-notes":
        return json(response, 200, {
          result: (await listContactNotes(userId, payload.contactId as never)) ?? null,
        });
      case "create-contact-note":
        return json(response, 200, {
          result: (await createContactNote(userId, payload.contactId as never, payload.body as never)) ?? null,
        });
      case "list-contact-lists":
        return json(response, 200, {
          result: (await listContactLists(userId, payload.listType as never)) ?? null,
        });
      case "save-contact-list":
        return json(response, 200, {
          result: (await saveContactList(userId, payload.input as never)) ?? null,
        });
      case "delete-contact-list":
        return json(response, 200, {
          result: (await deleteContactList(userId, payload.listId as never)) ?? null,
        });
      case "add-contacts-to-list":
        return json(response, 200, {
          result: (await addContactsToList(userId, payload.listId as never, payload.contactIds as never, payload.sourceType as never, payload.sourceId as never)) ?? null,
        });
      case "remove-contacts-from-list":
        return json(response, 200, {
          result: (await removeContactsFromList(userId, payload.listId as never, payload.contactIds as never)) ?? null,
        });
      case "list-form-list-mappings":
        return json(response, 200, {
          result: (await listFormListMappings(userId, payload.formId as never)) ?? null,
        });
      case "save-form-list-mapping":
        return json(response, 200, {
          result: (await saveFormListMapping(userId, payload.input as never)) ?? null,
        });
      case "delete-form-list-mapping":
        return json(response, 200, {
          result: (await deleteFormListMapping(userId, payload.mappingId as never)) ?? null,
        });
      case "list-contact-custom-fields":
        return json(response, 200, {
          result: (await listContactCustomFields(userId)) ?? null,
        });
      case "create-contact-custom-field":
        return json(response, 200, {
          result: (await createContactCustomField(userId, payload.input as never)) ?? null,
        });
      case "update-contact-custom-field":
        return json(response, 200, {
          result: (await updateContactCustomField(userId, payload.fieldId as never, payload.input as never)) ?? null,
        });
      case "delete-contact-custom-field":
        return json(response, 200, {
          result: (await deleteContactCustomField(userId, payload.fieldId as never)) ?? null,
        });
      case "list-contact-campaigns":
        return json(response, 200, {
          result: (await listContactCampaigns(userId)) ?? null,
        });
      case "list-campaign-suppressions":
        return json(response, 200, {
          result:
            (await listCampaignSuppressions(
              userId,
              (payload.options || {}) as never,
            )) ?? null,
        });
      case "remove-campaign-suppressions":
        return json(response, 200, {
          result:
            (await removeCampaignSuppressions(
              userId,
              payload.suppressionIds as never,
            )) ?? null,
        });
      case "delete-campaign-suppressions-from-system":
        return json(response, 200, {
          result:
            (await deleteCampaignSuppressionsFromSystem(
              userId,
              payload.suppressionIds as never,
            )) ?? null,
        });
      case "save-contact-campaign":
        return json(response, 200, {
          result: (await saveContactCampaign(userId, payload.input as never)) ?? null,
        });
      case "schedule-contact-campaign":
        return json(response, 200, {
          result: (await scheduleContactCampaign(userId, payload.campaignId as never, payload.scheduledAt as never, (payload.options || {}) as never)) ?? null,
        });
      case "delete-contact-campaign":
        return json(response, 200, {
          result: (await deleteContactCampaign(userId, payload.campaignId as never)) ?? null,
        });
      case "bulk-update-contact-campaigns":
        return json(response, 200, {
          result: (await bulkUpdateContactCampaigns(
            userId,
            payload.campaignIds as never,
            payload.action as never,
          )) ?? null,
        });
      case "duplicate-contact-campaign":
        return json(response, 200, {
          result: (await duplicateContactCampaign(userId, payload.campaignId as never)) ?? null,
        });
      case "send-contact-campaign-now":
        return json(response, 200, {
          result: (await sendContactCampaignNow(userId, payload.campaignId as never)) ?? null,
        });
      case "retry-failed-campaign-recipients":
        return json(response, 200, {
          result: (await retryFailedCampaignRecipients(userId, payload.campaignId as never)) ?? 0,
        });
      case "list-campaign-recipients":
        return json(response, 200, {
          result:
            (await listContactCampaignRecipients(
              userId,
              payload.campaignId as never,
              (payload.options || {}) as never,
            )) ?? null,
        });
      case "cancel-contact-campaign":
        return json(response, 200, {
          result: (await cancelContactCampaign(userId, payload.campaignId as never)) ?? null,
        });
      case "pause-contact-campaign":
        return json(response, 200, {
          result: (await pauseContactCampaign(userId, payload.campaignId as never)) ?? null,
        });
      case "resume-contact-campaign":
        return json(response, 200, {
          result: (await resumeContactCampaign(userId, payload.campaignId as never, payload.scheduledAt as never)) ?? null,
        });
      case "archive-contact-campaign":
        return json(response, 200, {
          result: (await archiveContactCampaign(userId, payload.campaignId as never)) ?? null,
        });
      case "campaign-audience-preview":
        return json(response, 200, {
          result: (await getCampaignAudiencePreview(userId, payload.input as never)) ?? null,
        });
      case "send-campaign-test":
        return json(response, 200, {
          result: (await sendCampaignTest(userId, payload.campaignId as never, payload.recipient as never)) ?? null,
        });
      case "campaign-analytics":
        return json(response, 200, {
          result: (await getCampaignAnalytics(userId, payload.campaignId as never)) ?? null,
        });
      case "campaign-click-map":
        return json(response, 200, {
          result: (await getCampaignClickMap(userId, payload.campaignId as never)) ?? null,
        });
      case "campaign-performance-overview":
        return json(response, 200, {
          result:
            (await getCampaignPerformanceOverview(
              userId,
              payload.range as CampaignOverviewRange,
            )) ?? null,
        });
      case "list-campaign-variants":
        return json(response, 200, {
          result: (await listCampaignVariants(userId, payload.campaignId as never)) ?? null,
        });
      case "save-campaign-ab-test":
        return json(response, 200, {
          result: (await saveCampaignAbTest(userId, payload.campaignId as never, payload.input as never)) ?? null,
        });
      case "save-campaign-builder-state":
        return json(response, 200, {
          result: (await saveCampaignBuilderState(userId, payload.campaignId as never, payload.input as never)) ?? null,
        });
      case "complete-campaign-builder":
        return json(response, 200, {
          result: (await completeCampaignBuilder(userId, payload.campaignId as never)) ?? null,
        });
      case "campaign-wizard-recipients":
        return json(response, 200, {
          result: (await saveCampaignWizardRecipients(userId, payload.campaignId as never, payload.input as never)) ?? null,
        });
      case "campaign-wizard-identities":
        return json(response, 200, {
          result: (await getCampaignWizardIdentities(userId, payload.campaignId as never)) ?? null,
        });
      case "campaign-wizard-identity":
        return json(response, 200, {
          result: (await saveCampaignWizardIdentity(userId, payload.campaignId as never, payload.input as never)) ?? null,
        });
      case "campaign-wizard-review":
        return json(response, 200, {
          result: (await getCampaignWizardReview(userId, payload.campaignId as never)) ?? null,
        });
      case "campaign-wizard-schedule":
        return json(response, 200, {
          result: (await scheduleCampaignFromWizard(userId, payload.campaignId as never, payload.input as never)) ?? null,
        });
      case "campaign-send-progress":
        return json(response, 200, {
          result: (await getContactCampaignSendProgress(userId, payload.campaignId as never)) ?? null,
        });
      case "get-campaign-settings":
        return json(response, 200, {
          result: (await getCampaignSettings(userId)) ?? null,
        });
      case "save-campaign-settings":
        return json(response, 200, {
          result: (await saveCampaignSettings(userId, payload.settings as never)) ?? null,
        });
      case "get-contact-crm-settings":
        return json(response, 200, {
          result: (await getContactCrmSettings(userId)) ?? null,
        });
      case "save-contact-crm-settings":
        return json(response, 200, {
          result: (await saveContactCrmSettings(userId, payload.settings as never)) ?? null,
        });
      case "import-contacts":
        return json(response, 200, {
          result: (await importContacts(userId, payload.fileName as never, payload.listId as never, payload.rows as never)) ?? null,
        });
      case "sync-submission-contact":
        return json(response, 200, {
          result: (await syncSubmissionContact(payload.form as never, payload.submissionId as never, payload.answers as never)) ?? null,
        });
      case "list-contact-payments":
        return json(response, 200, {
          result: (await listContactPayments(userId, payload.contactEmail as never)) ?? null,
        });
      default:
        json(response, 404, { error: "This action is not available." });
        return;
    }
  } catch (error) {
    if (error instanceof DataError) {
      json(response, error.status, { error: error.message, code: error.code });
      return;
    }
    const message =
      error instanceof Error ? error.message : "This request failed.";
    console.error("[contacts] request failure", {
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 400, { error: message, code: "request_failed" });
  }
}

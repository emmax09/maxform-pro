import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import { listAnalytics } from "./analytics-data";
import { workspaceScopeFor } from "./workspace-access";

/**
 * Server-side CRM data layer.
 *
 * Every CRM read and write runs here against DATABASE_URL, which never leaves
 * the server. The browser talks to this handler with its session token, and
 * the workspace id always comes from that token rather than from the request
 * body, so a client cannot ask for another workspace's records.
 */

class CrmDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "crm_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new CrmDataError(
      "The CRM is temporarily unavailable.",
      503,
      "crm_unavailable",
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
    throw new CrmDataError(
      "The CRM is temporarily unavailable.",
      503,
      "crm_unavailable",
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
    throw new CrmDataError(
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
    if (error instanceof CrmDataError) throw error;
    throw new CrmDataError(
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
    if (body.length > 2_000_000) {
      throw new CrmDataError("This CRM request is too large.", 413);
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
    throw new CrmDataError("This CRM request could not be read.", 400);
  }
};


type DatabaseRow = Record<string, unknown>;

const asString = (value: unknown) =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const asNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const asBoolean = (value: unknown) =>
  value === true || value === "true" || value === 1;

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

export type CrmCompany = {
  id: string;
  name: string;
  industry: string;
  website: string;
  address: Record<string, unknown>;
  ownerId: string | null;
  revenueCents: number;
  employeeCount: number | null;
  notes: string;
  contactCount: number;
  dealCount: number;
  activeDealValueCents: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmLeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "unqualified"
  | "converted"
  | "archived";

export type CrmLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  sourceType: string;
  sourceId: string | null;
  sourceLabel: string;
  status: CrmLeadStatus;
  score: number;
  scoreReasons: string[];
  assignedUserId: string | null;
  assignedUserName: string;
  companyId: string | null;
  companyName: string;
  budgetCents: number;
  interestNotes: string;
  convertedContactId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmPipelineStage = {
  id: string;
  name: string;
  orderIndex: number;
  probability: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
  requiredFields: string[];
  staleAfterDays: number | null;
};

export type CrmPipeline = {
  id: string;
  name: string;
  description: string;
  color: string;
  isDefault: boolean;
  stages: CrmPipelineStage[];
  createdAt: string;
  updatedAt: string;
};

export type CrmDeal = {
  id: string;
  name: string;
  contactId: string | null;
  contactName: string;
  companyId: string | null;
  companyName: string;
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
  stageColor: string;
  isWon: boolean;
  isLost: boolean;
  valueCents: number;
  currency: string;
  probability: number;
  probabilityPinned: boolean;
  stageEnteredAt: string;
  expectedCloseDate: string | null;
  ownerId: string | null;
  ownerName: string;
  orderId: string | null;
  lostReason: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type CrmTaskPriority = "low" | "normal" | "high" | "urgent";
export type CrmTaskStatus =
  | "open"
  | "in_progress"
  | "completed"
  | "cancelled";

export type CrmTask = {
  id: string;
  title: string;
  description: string;
  dueAt: string | null;
  priority: CrmTaskPriority;
  status: CrmTaskStatus;
  contactId: string | null;
  contactName: string;
  companyId: string | null;
  companyName: string;
  dealId: string | null;
  dealName: string;
  assignedUserId: string | null;
  assignedUserName: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmActivity = {
  id: string;
  activityType: string;
  title: string;
  detail: string;
  contactId: string | null;
  contactName: string;
  companyId: string | null;
  companyName: string;
  dealId: string | null;
  dealName: string;
  taskId: string | null;
  actorName: string;
  createdAt: string;
};

export type CrmContactSummary = {
  id: string;
  fullName: string;
  email: string;
  company: string;
  companyId: string | null;
  lifecycleStage: string;
  lastActivityAt: string;
  createdAt: string;
};

export type CrmContactProfile = CrmContactSummary & {
  phone: string;
  jobTitle: string;
  address: Record<string, unknown>;
  preferredChannel: string;
  tags: string[];
  customFields: Record<string, unknown>;
  ownerId: string | null;
  ownerName: string;
  unsubscribedAt: string | null;
  sourceType: string;
  sourceId: string | null;
  updatedAt: string;
};

export type CrmTimelineEvent = {
  id: string;
  eventType: string;
  sourceModule: string;
  relatedRecordId: string | null;
  relatedRecordType: string;
  contactId: string | null;
  contactName: string;
  companyId: string | null;
  companyName: string;
  dealId: string | null;
  dealName: string;
  actorName: string;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

export type CrmAttentionItem = {
  id: string;
  title: string;
  reason: string;
  severity: "info" | "low" | "medium" | "high" | "urgent";
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
};

export type CrmNextBestAction = {
  id: string;
  title: string;
  reason: string;
  actionLabel: string;
  entityType: string;
  entityId: string;
  contactId: string | null;
  priority: CrmAttentionItem["severity"];
  dueAt: string | null;
  evidence: string[];
  createdAt: string;
};

export type CrmRelationshipInsight = {
  id: string;
  contactId: string | null;
  type: "risk" | "opportunity" | "momentum";
  title: string;
  detail: string;
  score: number;
  evidence: string[];
  createdAt: string;
};

export type CrmCommandCenter = {
  nextActions: CrmNextBestAction[];
  insights: CrmRelationshipInsight[];
  metrics: {
    trackedRelationships: number;
    atRiskRelationships: number;
    openNextActions: number;
    pipelineAtRiskCents: number;
    recentRevenue: number;
    highIntentLeads: number;
  };
};

export type CrmSegmentSummary = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  filterDefinition: unknown[];
  updatedAt: string;
};

export type CrmLinkedForm = {
  id: string;
  title: string;
  submittedAt: string;
};

export type CrmLinkedEvent = {
  id: string;
  title: string;
  ticketType: string;
  ticketNumber: string;
  status: string;
  checkedInAt: string | null;
  createdAt: string;
};

export type CrmLinkedAppointment = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  locationType: string;
  meetingUrl: string;
  amount: number;
  currency: string;
};

export type CrmLinkedDocument = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type CrmLinkedFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sourceType: string;
  sourceId: string | null;
  createdAt: string;
};

export type CrmLinkedPayment = {
  id: string;
  orderNumber: string;
  amount: number;
  currency: string;
  status: string;
  sourceType: string;
  paidAt: string | null;
  createdAt: string;
};

export type CrmLinkedCampaign = {
  id: string;
  campaignId: string;
  campaignName: string;
  status: string;
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
};

export type CrmContact360 = {
  contact: CrmContactProfile;
  company: {
    id: string;
    name: string;
    industry: string;
    website: string;
  } | null;
  relatedContacts: CrmContactSummary[];
  relationships: Array<{
    id: string;
    contactId: string;
    contactName: string;
    relationshipType: string;
    notes: string;
    direction: "inbound" | "outbound";
  }>;
  duplicateCandidates: CrmContactSummary[];
  deals: CrmDeal[];
  tasks: CrmTask[];
  notes: Array<{
    id: string;
    body: string;
    createdAt: string;
    updatedAt: string;
  }>;
  timeline: CrmTimelineEvent[];
  forms: CrmLinkedForm[];
  events: CrmLinkedEvent[];
  appointments: CrmLinkedAppointment[];
  documents: CrmLinkedDocument[];
  files: CrmLinkedFile[];
  payments: CrmLinkedPayment[];
  campaigns: CrmLinkedCampaign[];
  metrics: {
    totalRevenue: number;
    paymentCount: number;
    activeDealValueCents: number;
    wonDealValueCents: number;
    openTaskCount: number;
    lastActivityAt: string | null;
    nextActivityAt: string | null;
    engagementScore: number;
  };
  health: {
    score: number;
    status: "healthy" | "watch" | "at_risk";
    reasons: string[];
  };
};

export type CrmSearchResult = {
  id: string;
  resultType: "contact" | "company" | "lead" | "deal";
  title: string;
  subtitle: string;
  status: string;
};

export type CrmCalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
};

export type CrmRevenuePoint = {
  period: string;
  revenue: number;
  orders: number;
};

export type CrmWorkspaceData = {
  currency: string;
  companies: CrmCompany[];
  leads: CrmLead[];
  pipelines: CrmPipeline[];
  deals: CrmDeal[];
  tasks: CrmTask[];
  activities: CrmActivity[];
  contacts: CrmContactSummary[];
  events: CrmCalendarEvent[];
  revenue: CrmRevenuePoint[];
  attention?: CrmAttentionItem[];
  segments?: CrmSegmentSummary[];
  commandCenter?: CrmCommandCenter;
};

const mapCompany = (row: DatabaseRow): CrmCompany => ({
  id: asString(row.id),
  name: asString(row.name),
  industry: asString(row.industry),
  website: asString(row.website),
  address: asJson<Record<string, unknown>>(row.address, {}),
  ownerId: asString(row.owner_id) || null,
  revenueCents: asNumber(row.revenue_cents),
  employeeCount:
    row.employee_count == null ? null : asNumber(row.employee_count),
  notes: asString(row.notes),
  contactCount: asNumber(row.contact_count),
  dealCount: asNumber(row.deal_count),
  activeDealValueCents: asNumber(row.active_deal_value_cents),
  lastActivityAt: asString(row.last_activity_at) || null,
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
});

const mapLead = (row: DatabaseRow): CrmLead => ({
  id: asString(row.id),
  name: asString(row.name),
  email: asString(row.email),
  phone: asString(row.phone),
  sourceType: asString(row.source_type) || "manual",
  sourceId: asString(row.source_id) || null,
  sourceLabel: asString(row.source_label),
  status: (asString(row.status) || "new") as CrmLeadStatus,
  score: asNumber(row.score),
  scoreReasons: asJson<string[]>(row.score_reasons, []).map(String),
  assignedUserId: asString(row.assigned_user_id) || null,
  assignedUserName: asString(row.assigned_user_name),
  companyId: asString(row.company_id) || null,
  companyName: asString(row.company_name),
  budgetCents: asNumber(row.budget_cents),
  interestNotes: asString(row.interest_notes),
  convertedContactId: asString(row.converted_contact_id) || null,
  convertedAt: asString(row.converted_at) || null,
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
});

const mapStage = (row: DatabaseRow): CrmPipelineStage => ({
  id: asString(row.id),
  name: asString(row.name),
  orderIndex: asNumber(row.order_index),
  probability: asNumber(row.probability),
  color: asString(row.color) || "#64748B",
  isWon: asBoolean(row.is_won),
  isLost: asBoolean(row.is_lost),
  requiredFields: asJson<string[]>(row.required_fields, []).map(String),
  staleAfterDays:
    row.stale_after_days == null ? null : asNumber(row.stale_after_days),
});

const mapDeal = (row: DatabaseRow): CrmDeal => ({
  id: asString(row.id),
  name: asString(row.name),
  contactId: asString(row.contact_id) || null,
  contactName: asString(row.contact_name),
  companyId: asString(row.company_id) || null,
  companyName: asString(row.company_name),
  pipelineId: asString(row.pipeline_id),
  pipelineName: asString(row.pipeline_name),
  stageId: asString(row.stage_id),
  stageName: asString(row.stage_name),
  stageColor: asString(row.stage_color) || "#64748B",
  isWon: asBoolean(row.is_won),
  isLost: asBoolean(row.is_lost),
  valueCents: asNumber(row.value_cents),
  currency: asString(row.currency) || "USD",
  probability: asNumber(row.probability),
  probabilityPinned: asBoolean(row.probability_pinned),
  stageEnteredAt: asString(row.stage_entered_at),
  expectedCloseDate: asString(row.expected_close_date) || null,
  ownerId: asString(row.owner_id) || null,
  ownerName: asString(row.owner_name),
  orderId: asString(row.order_id) || null,
  lostReason: asString(row.lost_reason),
  notes: asString(row.notes),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
});

const mapTask = (row: DatabaseRow): CrmTask => ({
  id: asString(row.id),
  title: asString(row.title),
  description: asString(row.description),
  dueAt: asString(row.due_at) || null,
  priority: (asString(row.priority) || "normal") as CrmTaskPriority,
  status: (asString(row.status) || "open") as CrmTaskStatus,
  contactId: asString(row.contact_id) || null,
  contactName: asString(row.contact_name),
  companyId: asString(row.company_id) || null,
  companyName: asString(row.company_name),
  dealId: asString(row.deal_id) || null,
  dealName: asString(row.deal_name),
  assignedUserId: asString(row.assigned_user_id) || null,
  assignedUserName: asString(row.assigned_user_name),
  completedAt: asString(row.completed_at) || null,
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
});

const mapTimelineEvent = (row: DatabaseRow): CrmTimelineEvent => ({
  id: asString(row.id),
  eventType: asString(row.event_type),
  sourceModule: asString(row.source_module) || "crm",
  relatedRecordId: asString(row.related_record_id) || null,
  relatedRecordType: asString(row.related_record_type),
  contactId: asString(row.contact_id) || null,
  contactName: asString(row.contact_name),
  companyId: asString(row.company_id) || null,
  companyName: asString(row.company_name),
  dealId: asString(row.deal_id) || null,
  dealName: asString(row.deal_name),
  actorName: asString(row.actor_name),
  title: asString(row.title),
  detail: asString(row.detail),
  metadata: asJson<Record<string, unknown>>(row.metadata, {}),
  occurredAt: asString(row.occurred_at),
});

const mapContactProfile = (row: DatabaseRow): CrmContactProfile => ({
  id: asString(row.id),
  fullName: asString(row.full_name),
  email: asString(row.email),
  phone: asString(row.phone),
  company: asString(row.legacy_company || row.company),
  companyId: asString(row.company_id) || null,
  lifecycleStage: asString(row.lifecycle_stage) || "lead",
  lastActivityAt: asString(row.last_activity_at),
  createdAt: asString(row.created_at),
  jobTitle: asString(row.job_title),
  address: asJson<Record<string, unknown>>(row.address, {}),
  preferredChannel: asString(row.preferred_channel),
  tags: asJson<string[]>(row.tags, []).map(String),
  customFields: asJson<Record<string, unknown>>(row.custom_fields, {}),
  ownerId: asString(row.owner_id) || null,
  ownerName: asString(row.owner_name),
  unsubscribedAt: asString(row.unsubscribed_at) || null,
  sourceType: asString(row.source_type) || "manual",
  sourceId: asString(row.source_id) || null,
  updatedAt: asString(row.updated_at),
});

const timelineSelect = `
  SELECT timeline.id::text,
    timeline.event_type,
    timeline.source_module,
    timeline.related_record_id,
    timeline.related_record_type,
    timeline.contact_id,
    COALESCE(NULLIF(contact.full_name, ''), contact.email, '') AS contact_name,
    timeline.company_id,
    COALESCE(company.name, contact.company, '') AS company_name,
    timeline.deal_id,
    deal.name AS deal_name,
    actor.full_name AS actor_name,
    timeline.title,
    timeline.detail,
    timeline.metadata,
    timeline.occurred_at
  FROM crm_timeline_events timeline
  LEFT JOIN contacts contact ON contact.id = timeline.contact_id
  LEFT JOIN companies company ON company.id = timeline.company_id
  LEFT JOIN deals deal ON deal.id = timeline.deal_id
  LEFT JOIN users actor ON actor.id = timeline.actor_user_id
`;

const buildCrmAttention = (input: {
  leads: CrmLead[];
  deals: CrmDeal[];
  tasks: CrmTask[];
  contacts: CrmContactSummary[];
  stages: CrmPipelineStage[];
  invoices: DatabaseRow[];
}) => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const items: CrmAttentionItem[] = [];
  const add = (
    item: Omit<CrmAttentionItem, "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    },
  ) =>
    items.push({
      ...item,
      id: item.id || `${item.entityType}:${item.entityId}:${items.length}`,
      createdAt: item.createdAt || new Date().toISOString(),
    });

  input.leads.forEach((lead) => {
    if (["converted", "unqualified", "archived"].includes(lead.status)) return;
    const lastActivity = new Date(lead.updatedAt).getTime();
    const untouched = !Number.isFinite(lastActivity) || now - lastActivity > 7 * day;
    if (untouched || !lead.assignedUserId) {
      add({
        title: lead.name || lead.email || "Lead needs an owner",
        reason: [
          !lead.assignedUserId ? "No owner assigned" : "No recent activity",
          untouched ? "Older than seven days" : "",
        ]
          .filter(Boolean)
          .join(" · "),
        severity: !lead.assignedUserId ? "high" : "medium",
        action: "Review lead",
        entityType: "lead",
        entityId: lead.id,
        createdAt: lead.updatedAt,
      });
    }
  });

  const stageById = new Map(input.stages.map((stage) => [stage.id, stage]));
  input.deals.forEach((deal) => {
    if (deal.isWon || deal.isLost) return;
    const stage = stageById.get(deal.stageId);
    const threshold = (stage?.staleAfterDays || 14) * day;
    const entered = new Date(deal.stageEnteredAt || deal.updatedAt).getTime();
    const closeTime = deal.expectedCloseDate
      ? new Date(`${deal.expectedCloseDate}T23:59:59`).getTime()
      : NaN;
    if (Number.isFinite(entered) && now - entered > threshold) {
      add({
        title: deal.name,
        reason: `Stale in ${deal.stageName} for more than ${stage?.staleAfterDays || 14} days`,
        severity: "high",
        action: "Open deal",
        entityType: "deal",
        entityId: deal.id,
        createdAt: deal.stageEnteredAt || deal.updatedAt,
      });
    } else if (Number.isFinite(closeTime) && closeTime - now <= 7 * day) {
      add({
        title: deal.name,
        reason: "Expected close date is within seven days",
        severity: "urgent",
        action: "Open deal",
        entityType: "deal",
        entityId: deal.id,
        // Nullable in the row, optional in the item: `null` would defeat the
        // `|| new Date()` default that add() applies.
        createdAt: deal.expectedCloseDate || undefined,
      });
    }
  });

  input.tasks.forEach((task) => {
    if (!task.dueAt || ["completed", "cancelled"].includes(task.status)) return;
    const due = new Date(task.dueAt).getTime();
    if (Number.isFinite(due) && due < now) {
      add({
        title: task.title,
        reason: `Overdue ${task.priority === "urgent" ? "urgent " : ""}task`,
        severity: task.priority === "urgent" ? "urgent" : "high",
        action: "Review task",
        entityType: "task",
        entityId: task.id,
        createdAt: task.dueAt,
      });
    }
  });

  input.contacts.forEach((contact) => {
    if (contact.lifecycleStage !== "customer") return;
    const lastActivity = new Date(contact.lastActivityAt).getTime();
    if (Number.isFinite(lastActivity) && now - lastActivity > 30 * day) {
      add({
        title: contact.fullName || contact.email,
        reason: "Customer has had no recorded activity for 30 days",
        severity: "medium",
        action: "Open Customer 360",
        entityType: "contact",
        entityId: contact.id,
        createdAt: contact.lastActivityAt,
      });
    }
  });

  input.invoices.forEach((invoice) => {
    const status = asString(invoice.status);
    const dueAt = asString(invoice.due_at);
    const overdue = status === "overdue" ||
      (status === "open" && dueAt && new Date(dueAt).getTime() < now);
    if (!overdue) return;
    add({
      title: asString(invoice.invoice_number) || "Overdue invoice",
      reason: `${asString(invoice.customer_name) || asString(invoice.customer_email)} · payment overdue`,
      severity: "urgent",
      action: "Review payment",
      entityType: "invoice",
      entityId: asString(invoice.id),
      createdAt: dueAt || asString(invoice.updated_at),
    });
  });

  return items
    .sort((left, right) => {
      const rank = { urgent: 4, high: 3, medium: 2, low: 1, info: 0 };
      return rank[right.severity] - rank[left.severity];
    })
    .slice(0, 100);
};

const buildCrmCommandCenter = (input: {
  attention: CrmAttentionItem[];
  contacts: CrmContactSummary[];
  leads: CrmLead[];
  deals: CrmDeal[];
  tasks: CrmTask[];
  activities: CrmActivity[];
  revenue: CrmRevenuePoint[];
}): CrmCommandCenter => {
  const contactById = new Map(input.contacts.map((contact) => [contact.id, contact]));
  const leadById = new Map(input.leads.map((lead) => [lead.id, lead]));
  const dealById = new Map(input.deals.map((deal) => [deal.id, deal]));
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const nextActions = input.attention.slice(0, 12).map((item) => {
    const lead = item.entityType === "lead" ? leadById.get(item.entityId) : null;
    const deal = item.entityType === "deal" ? dealById.get(item.entityId) : null;
    const task = item.entityType === "task" ? taskById.get(item.entityId) : null;
    const contactId =
      item.entityType === "contact"
        ? item.entityId
        : lead?.convertedContactId || deal?.contactId || task?.contactId || null;
    const evidence: string[] = [item.reason];
    let actionLabel = item.action;
    let dueAt: string | null = null;

    if (lead) {
      actionLabel = "Open lead";
      evidence.push(`Lead score ${lead.score}/100`);
      if (lead.sourceLabel) evidence.push(`Source: ${lead.sourceLabel}`);
      if (lead.budgetCents > 0) evidence.push("Budget was provided");
    } else if (deal) {
      actionLabel = "Open deal";
      dueAt = deal.expectedCloseDate
        ? `${deal.expectedCloseDate}T23:59:59.000Z`
        : null;
      evidence.push(`Pipeline stage: ${deal.stageName}`);
      if (deal.probability > 0) evidence.push(`Forecast probability ${deal.probability}%`);
      if (deal.contactName) evidence.push(`Contact: ${deal.contactName}`);
    } else if (task) {
      actionLabel = "Open tasks";
      dueAt = task.dueAt;
      if (task.priority) evidence.push(`Priority: ${task.priority}`);
      if (task.contactName) evidence.push(`Contact: ${task.contactName}`);
    } else if (item.entityType === "contact") {
      actionLabel = "Open Customer 360";
      const contact = contactById.get(item.entityId);
      if (contact?.company) evidence.push(`Company: ${contact.company}`);
    } else if (item.entityType === "invoice") {
      actionLabel = "Open payments";
      evidence.push("Payment status is surfaced from the shared payment ledger");
    }

    return {
      id: `next:${item.id}`,
      title: item.title,
      reason: item.reason,
      actionLabel,
      entityType: item.entityType,
      entityId: item.entityId,
      contactId,
      priority: item.severity,
      dueAt,
      evidence: Array.from(new Set(evidence)).slice(0, 4),
      createdAt: item.createdAt,
    } satisfies CrmNextBestAction;
  });

  const atRiskContactIds = new Set<string>();
  input.attention.forEach((item) => {
    if (item.entityType === "contact" && contactById.has(item.entityId)) {
      atRiskContactIds.add(item.entityId);
    }
    const deal = item.entityType === "deal" ? dealById.get(item.entityId) : null;
    const task = item.entityType === "task" ? taskById.get(item.entityId) : null;
    if (deal?.contactId) atRiskContactIds.add(deal.contactId);
    if (task?.contactId) atRiskContactIds.add(task.contactId);
  });

  const insights: CrmRelationshipInsight[] = [];
  input.leads
    .filter((lead) => !["converted", "unqualified", "archived"].includes(lead.status) && lead.score >= 70)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .forEach((lead) => {
      insights.push({
        id: `insight:lead:${lead.id}`,
        contactId: lead.convertedContactId,
        type: "opportunity",
        title: `${lead.name || lead.email || "Lead"} has buying intent`,
        detail: "Prioritize a human follow-up while the signal is fresh.",
        score: Math.min(100, Math.max(0, lead.score)),
        evidence: [
          `Lead score ${lead.score}/100`,
          lead.sourceLabel ? `Source: ${lead.sourceLabel}` : "Source: manual or imported",
          lead.budgetCents > 0 ? "Budget was provided" : "No budget recorded yet",
        ],
        createdAt: lead.updatedAt,
      });
    });

  input.deals
    .filter((deal) => !deal.isWon && !deal.isLost)
    .filter((deal) => {
      const closeAt = deal.expectedCloseDate
        ? new Date(`${deal.expectedCloseDate}T23:59:59`).getTime()
        : NaN;
      return deal.probability >= 50 || (Number.isFinite(closeAt) && closeAt - now <= 30 * day);
    })
    .sort((left, right) => right.valueCents - left.valueCents)
    .slice(0, 3)
    .forEach((deal) => {
      insights.push({
        id: `insight:deal:${deal.id}`,
        contactId: deal.contactId,
        type: "opportunity",
        title: `${deal.name} is forecastable`,
        detail: "A meaningful open deal has a near-term close or a strong stage probability.",
        score: Math.min(100, Math.max(0, deal.probability)),
        evidence: [
          `Stage: ${deal.stageName}`,
          `Forecast probability ${deal.probability}%`,
          deal.expectedCloseDate ? `Expected close ${deal.expectedCloseDate}` : "No expected close date recorded",
        ],
        createdAt: deal.updatedAt,
      });
    });

  Array.from(atRiskContactIds)
    .map((contactId) => contactById.get(contactId))
    .filter((contact): contact is CrmContactSummary => Boolean(contact))
    .slice(0, 3)
    .forEach((contact) => {
      const lastActivity = new Date(contact.lastActivityAt).getTime();
      const days = Number.isFinite(lastActivity)
        ? Math.max(0, Math.floor((now - lastActivity) / day))
        : null;
      insights.push({
        id: `insight:risk:${contact.id}`,
        contactId: contact.id,
        type: "risk",
        title: `${contact.fullName || contact.email || "Relationship"} needs attention`,
        detail: "A relationship signal is aging or an open piece of work is blocked.",
        score: Math.min(100, 60 + (days == null ? 25 : Math.min(40, Math.floor(days / 3)))),
        evidence: [
          days == null ? "No reliable last-activity timestamp" : `Last activity ${days} days ago`,
          contact.company ? `Company: ${contact.company}` : "No company linked",
        ],
        createdAt: contact.lastActivityAt || new Date().toISOString(),
      });
    });

  const activityCounts = new Map<string, number>();
  input.activities.forEach((activity) => {
    if (!activity.contactId) return;
    const occurredAt = new Date(activity.createdAt).getTime();
    if (!Number.isFinite(occurredAt) || now - occurredAt > 30 * day) return;
    activityCounts.set(activity.contactId, (activityCounts.get(activity.contactId) || 0) + 1);
  });
  Array.from(activityCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .forEach(([contactId, count]) => {
      const contact = contactById.get(contactId);
      if (!contact) return;
      insights.push({
        id: `insight:momentum:${contactId}`,
        contactId,
        type: "momentum",
        title: `${contact.fullName || contact.email || "Relationship"} is active`,
        detail: "Multiple recent CRM touches indicate momentum worth protecting.",
        score: Math.min(100, 50 + count * 12),
        evidence: [`${count} CRM touch${count === 1 ? "" : "es"} in the last 30 days`],
        createdAt: contact.lastActivityAt || new Date().toISOString(),
      });
    });

  const recentRevenue = input.revenue.reduce((sum, point) => {
    const periodAt = new Date(`${point.period}-01T00:00:00`).getTime();
    return Number.isFinite(periodAt) && now - periodAt <= 60 * day
      ? sum + point.revenue
      : sum;
  }, 0);
  const atRiskDealIds = new Set(
    input.attention
      .filter((item) => item.entityType === "deal")
      .map((item) => item.entityId),
  );

  return {
    nextActions,
    insights: insights.slice(0, 9),
    metrics: {
      trackedRelationships: input.contacts.length,
      atRiskRelationships: atRiskContactIds.size,
      openNextActions: nextActions.length,
      pipelineAtRiskCents: input.deals
        .filter((deal) => atRiskDealIds.has(deal.id))
        .reduce((sum, deal) => sum + deal.valueCents, 0),
      recentRevenue,
      highIntentLeads: input.leads.filter(
        (lead) => !["converted", "unqualified", "archived"].includes(lead.status) && lead.score >= 70,
      ).length,
    },
  };
};

const defaultStages = [
  { name: "New", probability: 10, color: "#64748B" },
  { name: "Qualified", probability: 30, color: "#2563EB" },
  { name: "Proposal", probability: 55, color: "#7C3AED" },
  { name: "Negotiation", probability: 75, color: "#D97706" },
  {
    name: "Won",
    probability: 100,
    color: "#059669",
    isWon: true,
  },
  {
    name: "Lost",
    probability: 0,
    color: "#E11D48",
    isLost: true,
  },
];

export async function ensureDefaultCrmPipeline(userId: string) {
  const existing = await query<DatabaseRow>(
    `SELECT id
     FROM pipelines
     WHERE user_id = $1
     ORDER BY is_default DESC, created_at
     LIMIT 1`,
    [userId],
  );

  let pipelineId = asString(existing.rows[0]?.id);
  if (!pipelineId) {
    const inserted = await query<DatabaseRow>(
      `INSERT INTO pipelines (
         user_id, name, description, color, is_default, created_at, updated_at
       )
       VALUES (
         $1, 'Sales', 'Your default revenue pipeline', '#635BFF', TRUE,
         NOW(), NOW()
       )
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [userId],
    );
    pipelineId = asString(inserted.rows[0]?.id);
    if (!pipelineId) {
      const winner = await query<DatabaseRow>(
        `SELECT id FROM pipelines
         WHERE user_id = $1
         ORDER BY is_default DESC, created_at
         LIMIT 1`,
        [userId],
      );
      pipelineId = asString(winner.rows[0]?.id);
    }
  }

  if (!pipelineId) throw new Error("The default CRM pipeline could not be created");

  const stageCount = await query<DatabaseRow>(
    `SELECT COUNT(*)::int AS count
     FROM pipeline_stages
     WHERE pipeline_id = $1`,
    [pipelineId],
  );
  if (asNumber(stageCount.rows[0]?.count) === 0) {
    await Promise.all(
      defaultStages.map((stage, index) =>
        query(
          `INSERT INTO pipeline_stages (
             pipeline_id, name, order_index, probability, color, is_won,
             is_lost, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT DO NOTHING`,
          [
            pipelineId,
            stage.name,
            index,
            stage.probability,
            stage.color,
            Boolean(stage.isWon),
            Boolean(stage.isLost),
          ],
        ),
      ),
    );
  }
  return pipelineId;
}

export async function getCrmWorkspace(
  userId: string,
): Promise<CrmWorkspaceData> {
  await ensureDefaultCrmPipeline(userId);

  const [
    companyResult,
    leadResult,
    pipelineResult,
    stageResult,
    dealResult,
    taskResult,
    activityResult,
    contactResult,
    eventResult,
    invoiceResult,
    segmentResult,
    analytics,
  ] = await Promise.all([
    query<DatabaseRow>(
      `SELECT company.*,
         (
           SELECT COUNT(*)::int
           FROM contacts contact
           WHERE contact.created_by = company.user_id
             AND (
               contact.company_id = company.id OR
               LOWER(contact.company) = LOWER(company.name)
             )
         ) AS contact_count,
         (
           SELECT COUNT(*)::int
           FROM deals deal
           WHERE deal.user_id = company.user_id
             AND deal.company_id = company.id
         ) AS deal_count,
         COALESCE((
           SELECT SUM(deal.value_cents)
           FROM deals deal
           JOIN pipeline_stages stage ON stage.id = deal.stage_id
           WHERE deal.user_id = company.user_id
             AND deal.company_id = company.id
             AND stage.is_lost = FALSE
         ), 0) AS active_deal_value_cents,
         (
           SELECT MAX(activity.created_at)
           FROM crm_activities activity
           WHERE activity.user_id = company.user_id
             AND activity.company_id = company.id
         ) AS last_activity_at
       FROM companies company
       WHERE company.user_id = $1
       ORDER BY company.updated_at DESC`,
      [userId],
    ),
    query<DatabaseRow>(
      `SELECT lead.*,
         company.name AS company_name,
         assigned.full_name AS assigned_user_name
       FROM leads lead
       LEFT JOIN companies company ON company.id = lead.company_id
       LEFT JOIN users assigned ON assigned.id = lead.assigned_user_id
       WHERE lead.user_id = $1
       ORDER BY lead.score DESC, lead.created_at DESC`,
      [userId],
    ),
    query<DatabaseRow>(
      `SELECT *
       FROM pipelines
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at`,
      [userId],
    ),
    query<DatabaseRow>(
      `SELECT stage.*
       FROM pipeline_stages stage
       JOIN pipelines pipeline ON pipeline.id = stage.pipeline_id
       WHERE pipeline.user_id = $1
       ORDER BY stage.pipeline_id, (stage.is_won OR stage.is_lost), stage.order_index`,
      [userId],
    ),
    query<DatabaseRow>(
      `SELECT deal.*,
         COALESCE(NULLIF(contact.full_name, ''), contact.email, '') AS contact_name,
         company.name AS company_name,
         pipeline.name AS pipeline_name,
         stage.name AS stage_name,
         stage.color AS stage_color,
         stage.is_won,
         stage.is_lost,
         owner.full_name AS owner_name
       FROM deals deal
       JOIN pipelines pipeline ON pipeline.id = deal.pipeline_id
       JOIN pipeline_stages stage ON stage.id = deal.stage_id
       LEFT JOIN contacts contact ON contact.id = deal.contact_id
       LEFT JOIN companies company ON company.id = deal.company_id
       LEFT JOIN users owner ON owner.id = deal.owner_id
       WHERE deal.user_id = $1
       ORDER BY stage.order_index, deal.updated_at DESC`,
      [userId],
    ),
    query<DatabaseRow>(
      `SELECT task.*,
         COALESCE(NULLIF(contact.full_name, ''), contact.email, '') AS contact_name,
         company.name AS company_name,
         deal.name AS deal_name,
         assigned.full_name AS assigned_user_name
       FROM tasks task
       LEFT JOIN contacts contact ON contact.id = task.contact_id
       LEFT JOIN companies company ON company.id = task.company_id
       LEFT JOIN deals deal ON deal.id = task.deal_id
       LEFT JOIN users assigned ON assigned.id = task.assigned_user_id
       WHERE task.user_id = $1
       ORDER BY
         CASE WHEN task.status = 'completed' THEN 1 ELSE 0 END,
         task.due_at NULLS LAST,
         task.created_at DESC`,
      [userId],
    ),
    query<DatabaseRow>(
      `SELECT activity.id::text,
         activity.activity_type,
         activity.title,
         activity.detail,
         activity.contact_id,
         COALESCE(NULLIF(contact.full_name, ''), contact.email, '') AS contact_name,
         activity.company_id,
         company.name AS company_name,
         activity.deal_id,
         deal.name AS deal_name,
         activity.task_id,
         actor.full_name AS actor_name,
         activity.created_at
       FROM crm_activities activity
       LEFT JOIN contacts contact ON contact.id = activity.contact_id
       LEFT JOIN companies company ON company.id = activity.company_id
       LEFT JOIN deals deal ON deal.id = activity.deal_id
       LEFT JOIN users actor ON actor.id = activity.actor_user_id
       WHERE activity.user_id = $1
       UNION ALL
       SELECT ('contact-' || activity.id::text) AS id,
         activity.activity_type,
         activity.title,
         activity.detail,
         activity.contact_id,
         COALESCE(NULLIF(contact.full_name, ''), contact.email, '') AS contact_name,
         contact.company_id,
         COALESCE(company.name, contact.company, '') AS company_name,
         CASE WHEN activity.entity_type = 'deal' THEN activity.entity_id ELSE NULL END AS deal_id,
         deal.name AS deal_name,
         NULL::uuid AS task_id,
         actor.full_name AS actor_name,
         activity.created_at
       FROM contact_activity activity
       JOIN contacts contact ON contact.id = activity.contact_id
       LEFT JOIN companies company ON company.id = contact.company_id
       LEFT JOIN deals deal
         ON deal.id = activity.entity_id AND activity.entity_type = 'deal'
       LEFT JOIN users actor ON actor.id = activity.user_id
       WHERE activity.user_id = $1
       UNION ALL
       SELECT ('timeline-' || timeline.id::text) AS id,
         timeline.event_type AS activity_type,
         timeline.title,
         timeline.detail,
         timeline.contact_id,
         COALESCE(NULLIF(contact.full_name, ''), contact.email, '') AS contact_name,
         timeline.company_id,
         COALESCE(company.name, contact.company, '') AS company_name,
         timeline.deal_id,
         deal.name AS deal_name,
         NULL::uuid AS task_id,
         actor.full_name AS actor_name,
         timeline.occurred_at AS created_at
       FROM crm_timeline_events timeline
       LEFT JOIN contacts contact ON contact.id = timeline.contact_id
       LEFT JOIN companies company ON company.id = timeline.company_id
       LEFT JOIN deals deal ON deal.id = timeline.deal_id
       LEFT JOIN users actor ON actor.id = timeline.actor_user_id
       WHERE timeline.user_id = $1
         AND timeline.source_module = 'stores'
       ORDER BY created_at DESC
       LIMIT 250`,
      [userId],
    ),
    query<DatabaseRow>(
      `SELECT id, full_name, email, company, company_id, lifecycle_stage,
         last_activity_at, created_at
       FROM contacts
       WHERE created_by = $1
       ORDER BY last_activity_at DESC`,
      [userId],
    ),
    query<DatabaseRow>(
      `SELECT id, title, starts_at, ends_at, status
       FROM events
       WHERE created_by = $1
         AND starts_at IS NOT NULL
       ORDER BY starts_at`,
      [userId],
    ),
    query<DatabaseRow>(
      `SELECT id, invoice_number, customer_name, customer_email, status,
              due_at, updated_at
       FROM payment_invoices
       WHERE user_id = $1
         AND status IN ('open', 'overdue')
       ORDER BY due_at NULLS LAST, updated_at DESC
       LIMIT 250`,
      [userId],
    ),
    query<DatabaseRow>(
      `SELECT list.id, list.name, list.description, list.filter_definition,
              list.updated_at,
              COUNT(member.contact_id)::int AS member_count
       FROM contact_lists list
       LEFT JOIN contact_list_members member ON member.list_id = list.id
       WHERE list.user_id = $1 AND list.list_type = 'dynamic'
       GROUP BY list.id
       ORDER BY list.updated_at DESC`,
      [userId],
    ),
    listAnalytics(userId, 365).catch(() => null),
  ]);

  const stagesByPipeline = new Map<string, CrmPipelineStage[]>();
  stageResult.rows.forEach((row) => {
    const pipelineId = asString(row.pipeline_id);
    const current = stagesByPipeline.get(pipelineId) || [];
    current.push(mapStage(row));
    stagesByPipeline.set(pipelineId, current);
  });
  const analyticsDaily = (Array.isArray(analytics?.daily)
    ? analytics.daily
    : []) as Array<{
    date: string;
    paid_orders: number;
    revenue: number;
  }>;
  const monthlyRevenue = Array.from(
    analyticsDaily.reduce((map, point) => {
      const period = point.date.slice(0, 7);
      const current = map.get(period) || { revenue: 0, orders: 0 };
      map.set(period, {
        revenue: current.revenue + point.revenue,
        orders: current.orders + point.paid_orders,
      });
      return map;
    }, new Map<string, { revenue: number; orders: number }>()),
  ).map(([period, totals]) => ({ period, ...totals }));

  const companies = companyResult.rows.map(mapCompany);
  const leads = leadResult.rows.map(mapLead);
  const pipelines = pipelineResult.rows.map((row) => ({
    id: asString(row.id),
    name: asString(row.name),
    description: asString(row.description),
    color: asString(row.color) || "#635BFF",
    isDefault: asBoolean(row.is_default),
    stages: stagesByPipeline.get(asString(row.id)) || [],
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }));
  const deals = dealResult.rows.map(mapDeal);
  const tasks = taskResult.rows.map(mapTask);
  const contacts = contactResult.rows.map((row) => ({
    id: asString(row.id),
    fullName: asString(row.full_name),
    email: asString(row.email),
    company: asString(row.company),
    companyId: asString(row.company_id) || null,
    lifecycleStage: asString(row.lifecycle_stage) || "lead",
    lastActivityAt: asString(row.last_activity_at),
    createdAt: asString(row.created_at),
  }));
  const attention = buildCrmAttention({
    leads,
    deals,
    tasks,
    contacts,
    stages: Array.from(stagesByPipeline.values()).flat(),
    invoices: invoiceResult.rows,
  });
  const activities = activityResult.rows.map((row) => ({
    id: asString(row.id),
    activityType: asString(row.activity_type),
    title: asString(row.title),
    detail: asString(row.detail),
    contactId: asString(row.contact_id) || null,
    contactName: asString(row.contact_name),
    companyId: asString(row.company_id) || null,
    companyName: asString(row.company_name),
    dealId: asString(row.deal_id) || null,
    dealName: asString(row.deal_name),
    taskId: asString(row.task_id) || null,
    actorName: asString(row.actor_name),
    createdAt: asString(row.created_at),
  }));
  const commandCenter = buildCrmCommandCenter({
    attention,
    contacts,
    leads,
    deals,
    tasks,
    activities,
    revenue: monthlyRevenue,
  });
  const segments = segmentResult.rows.map((row) => ({
    id: asString(row.id),
    name: asString(row.name),
    description: asString(row.description),
    memberCount: asNumber(row.member_count),
    filterDefinition: asJson<unknown[]>(row.filter_definition, []),
    updatedAt: asString(row.updated_at),
  }));

  return {
    currency: analytics?.summary.currency || "USD",
    companies,
    leads,
    pipelines,
    deals,
    tasks,
    activities,
    contacts,
    events: eventResult.rows.map((row) => ({
      id: asString(row.id),
      title: asString(row.title),
      startsAt: asString(row.starts_at),
      endsAt: asString(row.ends_at) || null,
      status: asString(row.status),
    })),
    revenue: monthlyRevenue,
    attention,
    segments,
    commandCenter,
  };
}

export async function listCrmTimeline(
  userId: string,
  input: {
    contactId?: string | null;
    sourceModule?: string;
    eventType?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {},
) {
  const conditions = ["timeline.user_id = $1"];
  const params: unknown[] = [userId];
  const addCondition = (condition: string, value: unknown) => {
    params.push(value);
    conditions.push(condition.replace("$VALUE", `$${params.length}`));
  };
  if (input.contactId) addCondition("timeline.contact_id = $VALUE", input.contactId);
  if (input.sourceModule?.trim()) {
    addCondition("timeline.source_module = $VALUE", input.sourceModule.trim());
  }
  if (input.eventType?.trim()) {
    addCondition("timeline.event_type = $VALUE", input.eventType.trim());
  }
  if (input.from) addCondition("timeline.occurred_at >= $VALUE::timestamptz", input.from);
  if (input.to) addCondition("timeline.occurred_at <= $VALUE::timestamptz", input.to);
  const limit = Math.max(1, Math.min(500, Math.round(input.limit || 100)));
  params.push(limit);
  const result = await query<DatabaseRow>(
    `${timelineSelect}
     WHERE ${conditions.join(" AND ")}
     ORDER BY timeline.occurred_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.map(mapTimelineEvent);
}

const mapContactSummary = (row: DatabaseRow): CrmContactSummary => ({
  id: asString(row.id),
  fullName: asString(row.full_name),
  email: asString(row.email),
  company: asString(row.company),
  companyId: asString(row.company_id) || null,
  lifecycleStage: asString(row.lifecycle_stage) || "lead",
  lastActivityAt: asString(row.last_activity_at),
  createdAt: asString(row.created_at),
});

export async function getCrmContact360(
  userId: string,
  contactId: string,
): Promise<CrmContact360> {
  const contactResult = await query<DatabaseRow>(
    `SELECT contact.*,
            contact.company AS legacy_company,
            owner.full_name AS owner_name,
            linked_company.id AS linked_company_id,
            linked_company.name AS linked_company_name,
            linked_company.industry AS linked_company_industry,
            linked_company.website AS linked_company_website
     FROM contacts contact
     LEFT JOIN users owner ON owner.id = contact.owner_id
     LEFT JOIN companies linked_company ON linked_company.id = contact.company_id
     WHERE contact.created_by = $1 AND contact.id = $2
     LIMIT 1`,
    [userId, contactId],
  );
  const contactRow = contactResult.rows[0];
  if (!contactRow) throw new Error("Contact not found");
  const contact = mapContactProfile(contactRow);
  const linkedCompanyId = asString(contactRow.linked_company_id) || null;
  const legacyCompany = asString(contactRow.legacy_company);

  const [
    dealsResult,
    tasksResult,
    notesResult,
    timelineResult,
    formResult,
    eventResult,
    appointmentResult,
    documentResult,
    fileResult,
    paymentResult,
    campaignResult,
    relatedContactResult,
    relationshipResult,
    duplicateResult,
  ] = await Promise.all([
    query<DatabaseRow>(
      `SELECT deal.*,
         COALESCE(NULLIF(contact.full_name, ''), contact.email, '') AS contact_name,
         company.name AS company_name,
         pipeline.name AS pipeline_name,
         stage.name AS stage_name,
         stage.color AS stage_color,
         stage.is_won,
         stage.is_lost,
         owner.full_name AS owner_name
       FROM deals deal
       JOIN pipelines pipeline ON pipeline.id = deal.pipeline_id
       JOIN pipeline_stages stage ON stage.id = deal.stage_id
       LEFT JOIN contacts contact ON contact.id = deal.contact_id
       LEFT JOIN companies company ON company.id = deal.company_id
       LEFT JOIN users owner ON owner.id = deal.owner_id
       WHERE deal.user_id = $1 AND deal.contact_id = $2
       ORDER BY deal.updated_at DESC`,
      [userId, contactId],
    ),
    query<DatabaseRow>(
      `SELECT task.*,
         COALESCE(NULLIF(contact.full_name, ''), contact.email, '') AS contact_name,
         company.name AS company_name,
         deal.name AS deal_name,
         assigned.full_name AS assigned_user_name
       FROM tasks task
       LEFT JOIN contacts contact ON contact.id = task.contact_id
       LEFT JOIN companies company ON company.id = task.company_id
       LEFT JOIN deals deal ON deal.id = task.deal_id
       LEFT JOIN users assigned ON assigned.id = task.assigned_user_id
       WHERE task.user_id = $1 AND task.contact_id = $2
       ORDER BY CASE WHEN task.status IN ('completed', 'cancelled') THEN 1 ELSE 0 END,
                task.due_at NULLS LAST, task.created_at DESC`,
      [userId, contactId],
    ),
    query<DatabaseRow>(
      `SELECT id, body, created_at, updated_at
       FROM contact_notes
       WHERE user_id = $1 AND contact_id = $2
       ORDER BY created_at DESC`,
      [userId, contactId],
    ),
    query<DatabaseRow>(
      `${timelineSelect}
       WHERE timeline.user_id = $1 AND timeline.contact_id = $2
       ORDER BY timeline.occurred_at DESC
       LIMIT 500`,
      [userId, contactId],
    ),
    query<DatabaseRow>(
      `SELECT DISTINCT submission.id, form.title, submission.submitted_at
       FROM contact_activity activity
       JOIN form_submissions submission
         ON submission.id = activity.entity_id
        AND activity.entity_type = 'submission'
       JOIN forms form ON form.id = submission.form_id
       WHERE activity.user_id = $1 AND activity.contact_id = $2
       ORDER BY submission.submitted_at DESC`,
      [userId, contactId],
    ),
    query<DatabaseRow>(
      `SELECT attendee.id, event.title, ticket.name AS ticket_type,
              attendee.ticket_number, attendee.ticket_status,
              attendee.checked_in_at, attendee.created_at
       FROM event_attendees attendee
       JOIN events event ON event.id = attendee.event_id
       LEFT JOIN event_ticket_types ticket ON ticket.id = attendee.ticket_type_id
       WHERE event.created_by = $1
         AND LOWER(attendee.email) = LOWER($2)
       ORDER BY attendee.created_at DESC`,
      [userId, contact.email],
    ),
    query<DatabaseRow>(
      `SELECT appointment.id,
              COALESCE(page.name, 'Appointment') AS title,
              appointment.starts_at, appointment.ends_at, appointment.status,
              appointment.location_type, appointment.meeting_url,
              appointment.amount_cents, appointment.currency
       FROM appointments appointment
       LEFT JOIN booking_pages page ON page.id = appointment.booking_page_id
       WHERE appointment.user_id = $1
         AND (appointment.contact_id = $2
              OR LOWER(appointment.invitee_email) = LOWER($3))
       ORDER BY appointment.starts_at DESC`,
      [userId, contactId, contact.email],
    ),
    query<DatabaseRow>(
      `SELECT DISTINCT document.id, document.title, document.status,
              document.created_at, document.updated_at
       FROM workspace_documents document
       LEFT JOIN document_signers signer ON signer.document_id = document.id
       WHERE document.user_id = $1
         AND (document.contact_id = $2 OR LOWER(signer.email) = LOWER($3))
       ORDER BY document.updated_at DESC`,
      [userId, contactId, contact.email],
    ),
    query<DatabaseRow>(
      `SELECT file.id, file.name, file.mime_type, file.size_bytes,
              file.source_type, file.source_id, file.created_at
       FROM workspace_files file
       WHERE file.user_id = $1 AND file.deleted_at IS NULL
         AND (
           file.source_id IN (
             SELECT activity.entity_id
             FROM contact_activity activity
             WHERE activity.user_id = $1
               AND activity.contact_id = $2
               AND activity.entity_id IS NOT NULL
           )
           OR file.source_id IN (
             SELECT document.id
             FROM workspace_documents document
             WHERE document.user_id = $1 AND document.contact_id = $2
           )
         )
       ORDER BY file.created_at DESC`,
      [userId, contactId],
    ),
    query<DatabaseRow>(
      `SELECT id, order_number, total_amount, currency, status, source_type,
              paid_at, created_at
       FROM payment_orders
       WHERE user_id = $1
         AND (contact_id = $2 OR LOWER(customer_email) = LOWER($3))
       ORDER BY COALESCE(paid_at, created_at) DESC`,
      [userId, contactId, contact.email],
    ),
    query<DatabaseRow>(
      `SELECT message.id, campaign.id AS campaign_id, campaign.name AS campaign_name,
              message.status, message.sent_at, message.opened_at, message.clicked_at
       FROM contact_campaign_messages message
       JOIN contact_campaigns campaign ON campaign.id = message.campaign_id
       WHERE campaign.user_id = $1 AND message.contact_id = $2
       ORDER BY message.updated_at DESC`,
      [userId, contactId],
    ),
    query<DatabaseRow>(
      `SELECT id, full_name, email, company, company_id, lifecycle_stage,
              last_activity_at, created_at
       FROM contacts
       WHERE created_by = $1 AND id <> $2
         AND (
           ($3 <> '' AND company_id = $4)
           OR ($3 <> '' AND LOWER(company) = LOWER($3))
         )
       ORDER BY last_activity_at DESC
       LIMIT 100`,
      [userId, contactId, legacyCompany, linkedCompanyId],
    ),
    query<DatabaseRow>(
      `SELECT relationship.contact_id,
              relationship.related_contact_id,
              relationship.relationship_type,
              relationship.notes,
              relationship.updated_at,
              other_contact.id AS other_contact_id,
              COALESCE(NULLIF(other_contact.full_name, ''), other_contact.email, '') AS other_contact_name
       FROM crm_contact_relationships relationship
       JOIN contacts other_contact
         ON other_contact.id = CASE
           WHEN relationship.contact_id = $2 THEN relationship.related_contact_id
           ELSE relationship.contact_id
         END
       WHERE relationship.user_id = $1
         AND (relationship.contact_id = $2 OR relationship.related_contact_id = $2)
       ORDER BY relationship.updated_at DESC
       LIMIT 100` ,
      [userId, contactId],
    ),
    query<DatabaseRow>(
      `SELECT id, full_name, email, company, company_id, lifecycle_stage,
              last_activity_at, created_at
       FROM contacts
       WHERE created_by = $1 AND id <> $2
         AND (
           ($3 <> '' AND LOWER(email) = LOWER($3))
           OR ($4 <> '' AND phone = $4)
           OR ($5 <> '' AND $6 <> ''
               AND LOWER(full_name) = LOWER($5)
               AND LOWER(company) = LOWER($6))
         )
       ORDER BY last_activity_at DESC
       LIMIT 50`,
      [userId, contactId, contact.email, contact.phone, contact.fullName, legacyCompany],
    ),
  ]);

  const deals = dealsResult.rows.map(mapDeal);
  const tasks = tasksResult.rows.map(mapTask);
  const timeline = timelineResult.rows.map(mapTimelineEvent);
  const payments = paymentResult.rows.map((row) => ({
    id: asString(row.id),
    orderNumber: asString(row.order_number),
    amount: asNumber(row.total_amount),
    currency: asString(row.currency) || "USD",
    status: asString(row.status),
    sourceType: asString(row.source_type),
    paidAt: asString(row.paid_at) || null,
    createdAt: asString(row.created_at),
  }));
  const activityTimes = timeline
    .map((event) => new Date(event.occurredAt).getTime())
    .filter(Number.isFinite);
  const lastActivityTime = Math.max(
    ...activityTimes,
    new Date(contact.lastActivityAt).getTime(),
  );
  const now = Date.now();
  const upcomingTimes = [
    ...tasks
      .filter((task) => task.status !== "completed" && task.status !== "cancelled")
      .map((task) => (task.dueAt ? new Date(task.dueAt).getTime() : NaN)),
    ...appointmentResult.rows.map((row) => new Date(asString(row.starts_at)).getTime()),
  ].filter((time) => Number.isFinite(time) && time >= now);
  const recentActivityCount = timeline.filter((event) => {
    const time = new Date(event.occurredAt).getTime();
    return Number.isFinite(time) && now - time <= 30 * 24 * 60 * 60 * 1000;
  }).length;
  const engagementScore = Math.min(
    100,
    recentActivityCount * 12 + payments.length * 10 + deals.length * 8,
  );
  const daysSinceActivity = Number.isFinite(lastActivityTime)
    ? (now - lastActivityTime) / (24 * 60 * 60 * 1000)
    : Infinity;
  const healthStatus: "healthy" | "watch" | "at_risk" =
    daysSinceActivity > 60 || (deals.some((deal) => !deal.isWon && !deal.isLost) && engagementScore < 20)
      ? "at_risk"
      : daysSinceActivity > 30 || engagementScore < 35
        ? "watch"
        : "healthy";
  const healthReasons = [
    daysSinceActivity > 60
      ? "No recorded activity in more than 60 days"
      : daysSinceActivity > 30
        ? "Activity is older than 30 days"
        : "Recent relationship activity is present",
    engagementScore >= 60
      ? "Strong recent engagement signals"
      : "Engagement signals are light",
    payments.length
      ? `${payments.length} payment record${payments.length === 1 ? "" : "s"} linked`
      : "No payment history linked yet",
  ];

  return {
    contact,
    company: linkedCompanyId
      ? {
          id: linkedCompanyId,
          name: asString(contactRow.linked_company_name) || legacyCompany,
          industry: asString(contactRow.linked_company_industry),
          website: asString(contactRow.linked_company_website),
        }
      : null,
    relatedContacts: relatedContactResult.rows.map(mapContactSummary),
    relationships: relationshipResult.rows.map((row) => {
      const sourceContactId = asString(row.contact_id);
      const relatedContactId = asString(row.related_contact_id);
      return {
        id: `${sourceContactId}:${relatedContactId}:${asString(row.relationship_type)}`,
        contactId: asString(row.other_contact_id),
        contactName: asString(row.other_contact_name),
        relationshipType: asString(row.relationship_type),
        notes: asString(row.notes),
        direction: sourceContactId === contactId ? "outbound" : "inbound",
      } as const;
    }),
    duplicateCandidates: duplicateResult.rows.map(mapContactSummary),
    deals,
    tasks,
    notes: notesResult.rows.map((row) => ({
      id: asString(row.id),
      body: asString(row.body),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    })),
    timeline,
    forms: formResult.rows.map((row) => ({
      id: asString(row.id),
      title: asString(row.title),
      submittedAt: asString(row.submitted_at),
    })),
    events: eventResult.rows.map((row) => ({
      id: asString(row.id),
      title: asString(row.title),
      ticketType: asString(row.ticket_type),
      ticketNumber: asString(row.ticket_number),
      status: asString(row.ticket_status),
      checkedInAt: asString(row.checked_in_at) || null,
      createdAt: asString(row.created_at),
    })),
    appointments: appointmentResult.rows.map((row) => ({
      id: asString(row.id),
      title: asString(row.title),
      startsAt: asString(row.starts_at),
      endsAt: asString(row.ends_at),
      status: asString(row.status),
      locationType: asString(row.location_type),
      meetingUrl: asString(row.meeting_url),
      amount: asNumber(row.amount_cents) / 100,
      currency: asString(row.currency) || "USD",
    })),
    documents: documentResult.rows.map((row) => ({
      id: asString(row.id),
      title: asString(row.title),
      status: asString(row.status),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    })),
    files: fileResult.rows.map((row) => ({
      id: asString(row.id),
      name: asString(row.name),
      mimeType: asString(row.mime_type),
      sizeBytes: asNumber(row.size_bytes),
      sourceType: asString(row.source_type),
      sourceId: asString(row.source_id) || null,
      createdAt: asString(row.created_at),
    })),
    payments,
    campaigns: campaignResult.rows.map((row) => ({
      id: asString(row.id),
      campaignId: asString(row.campaign_id),
      campaignName: asString(row.campaign_name),
      status: asString(row.status),
      sentAt: asString(row.sent_at) || null,
      openedAt: asString(row.opened_at) || null,
      clickedAt: asString(row.clicked_at) || null,
    })),
    metrics: {
      totalRevenue: payments
        .filter((payment) => ["paid", "partially_refunded", "refunded"].includes(payment.status))
        .reduce((sum, payment) => sum + payment.amount, 0),
      paymentCount: payments.length,
      activeDealValueCents: deals
        .filter((deal) => !deal.isWon && !deal.isLost)
        .reduce((sum, deal) => sum + deal.valueCents, 0),
      wonDealValueCents: deals
        .filter((deal) => deal.isWon)
        .reduce((sum, deal) => sum + deal.valueCents, 0),
      openTaskCount: tasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length,
      lastActivityAt: Number.isFinite(lastActivityTime)
        ? new Date(lastActivityTime).toISOString()
        : null,
      nextActivityAt: upcomingTimes.length
        ? new Date(Math.min(...upcomingTimes)).toISOString()
        : null,
      engagementScore,
    },
    health: {
      score: engagementScore,
      status: healthStatus,
      reasons: healthReasons,
    },
  };
}

export async function searchCrm(
  userId: string,
  term: string,
  limit = 30,
): Promise<CrmSearchResult[]> {
  const normalized = term.trim();
  if (!normalized) return [];
  const result = await query<DatabaseRow>(
    `SELECT result_id, result_type, title, subtitle, status
     FROM (
       SELECT contact.id AS result_id, 'contact' AS result_type,
              COALESCE(NULLIF(contact.full_name, ''), contact.email) AS title,
              COALESCE(NULLIF(contact.company, ''), contact.email) AS subtitle,
              contact.lifecycle_stage AS status
       FROM contacts contact
       WHERE contact.created_by = $1
         AND (contact.full_name ILIKE $2 OR contact.email ILIKE $2
              OR contact.phone ILIKE $2 OR contact.company ILIKE $2)
       UNION ALL
       SELECT company.id, 'company', company.name,
              COALESCE(company.industry, ''), 'company'
       FROM companies company
       WHERE company.user_id = $1 AND company.name ILIKE $2
       UNION ALL
       SELECT lead.id, 'lead', COALESCE(NULLIF(lead.name, ''), lead.email),
              COALESCE(lead.email, ''), lead.status
       FROM leads lead
       WHERE lead.user_id = $1
         AND (lead.name ILIKE $2 OR lead.email ILIKE $2 OR lead.phone ILIKE $2)
       UNION ALL
       SELECT deal.id, 'deal', deal.name,
              COALESCE(pipeline.name || ' · ' || stage.name, ''), stage.name
       FROM deals deal
       JOIN pipelines pipeline ON pipeline.id = deal.pipeline_id
       JOIN pipeline_stages stage ON stage.id = deal.stage_id
       WHERE deal.user_id = $1 AND deal.name ILIKE $2
     ) results
     ORDER BY title
     LIMIT $3`,
    [userId, `%${normalized}%`, Math.max(1, Math.min(100, Math.round(limit)))],
  );
  return result.rows.map((row) => ({
    id: asString(row.result_id),
    resultType: asString(row.result_type) as CrmSearchResult["resultType"],
    title: asString(row.title),
    subtitle: asString(row.subtitle),
    status: asString(row.status),
  }));
}

async function addCrmActivity(
  userId: string,
  input: {
    activityType: string;
    title: string;
    detail?: string;
    contactId?: string | null;
    companyId?: string | null;
    dealId?: string | null;
    taskId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await query(
    `INSERT INTO crm_activities (
       user_id, activity_type, title, detail, contact_id, company_id, deal_id,
       task_id, actor_user_id, metadata, created_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $1, $9::jsonb, NOW()
     )`,
    [
      userId,
      input.activityType,
      input.title,
      input.detail || "",
      input.contactId || null,
      input.companyId || null,
      input.dealId || null,
      input.taskId || null,
      JSON.stringify(input.metadata || {}),
    ],
  );
}

export async function createCrmCompany(
  userId: string,
  input: {
    name: string;
    industry?: string;
    website?: string;
    employeeCount?: number | null;
    revenueCents?: number;
    notes?: string;
  },
) {
  const result = await query<DatabaseRow>(
    `INSERT INTO companies (
       user_id, name, industry, website, owner_id, revenue_cents,
       employee_count, notes, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $1, $5, $6, $7, NOW(), NOW())
     RETURNING *`,
    [
      userId,
      input.name.trim(),
      input.industry?.trim() || "",
      input.website?.trim() || "",
      Math.max(0, input.revenueCents || 0),
      input.employeeCount ?? null,
      input.notes?.trim() || "",
    ],
  );
  const company = mapCompany(result.rows[0]);
  await addCrmActivity(userId, {
    activityType: "company_created",
    title: "Company created",
    detail: company.name,
    companyId: company.id,
  });
  return company;
}

const scoreLead = (input: {
  email?: string;
  phone?: string;
  sourceType?: string;
  companyId?: string | null;
  budgetCents?: number;
  interestNotes?: string;
}) => {
  let score = 0;
  const reasons: string[] = [];
  if (["form", "event", "campaign"].includes(input.sourceType || "")) {
    score += 30;
    reasons.push("Verified first-party source");
  } else {
    score += 10;
    reasons.push("Manually sourced lead");
  }
  if (input.email) {
    score += 15;
    reasons.push("Email available");
  }
  if (input.phone) {
    score += 10;
    reasons.push("Phone available");
  }
  if (input.companyId) {
    score += 15;
    reasons.push("Matched to a company");
  }
  if ((input.budgetCents || 0) >= 100_000) {
    score += 20;
    reasons.push("Strong stated budget");
  } else if ((input.budgetCents || 0) > 0) {
    score += 10;
    reasons.push("Budget provided");
  }
  if (input.interestNotes?.trim()) {
    score += 10;
    reasons.push("Buying interest documented");
  }
  return { score: Math.min(score, 100), reasons };
};

export async function createCrmLead(
  userId: string,
  input: {
    name: string;
    email?: string;
    phone?: string;
    sourceType?: string;
    sourceId?: string | null;
    sourceLabel?: string;
    companyId?: string | null;
    budgetCents?: number;
    interestNotes?: string;
  },
) {
  const scored = scoreLead(input);
  const normalizedEmail = input.email?.trim().toLowerCase() || "";
  if (normalizedEmail) {
    const duplicate = await query<DatabaseRow>(
      `SELECT *
       FROM leads
       WHERE user_id = $1
         AND LOWER(email) = $2
         AND status NOT IN ('converted', 'archived')
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, normalizedEmail],
    );
    if (duplicate.rows[0]) {
      const merged = await query<DatabaseRow>(
        `UPDATE leads
         SET name = COALESCE(NULLIF($1, ''), name),
             phone = COALESCE(NULLIF($2, ''), phone),
             company_id = COALESCE($3, company_id),
             budget_cents = GREATEST(budget_cents, $4),
             interest_notes = CASE
               WHEN NULLIF($5, '') IS NULL THEN interest_notes
               WHEN interest_notes = '' THEN $5
               ELSE interest_notes || E'\n' || $5
             END,
             score = GREATEST(score, $6),
             score_reasons = CASE
               WHEN $6 >= score THEN $7::jsonb
               ELSE score_reasons
             END,
             score_updated_at = NOW(),
             updated_at = NOW()
         WHERE id = $8 AND user_id = $9
         RETURNING *`,
        [
          input.name.trim(),
          input.phone?.trim() || "",
          input.companyId || null,
          Math.max(0, input.budgetCents || 0),
          input.interestNotes?.trim() || "",
          scored.score,
          JSON.stringify(scored.reasons),
          asString(duplicate.rows[0].id),
          userId,
        ],
      );
      const lead = mapLead(merged.rows[0]);
      await addCrmActivity(userId, {
        activityType: "lead_merged",
        title: "Lead details merged",
        detail: lead.name || lead.email,
        companyId: lead.companyId,
        metadata: { leadId: lead.id, matchedOn: "email" },
      });
      return lead;
    }
  }
  const result = await query<DatabaseRow>(
    `INSERT INTO leads (
       user_id, name, email, phone, source_type, source_id, source_label,
       status, score, score_reasons, assigned_user_id, company_id,
       budget_cents, interest_notes, score_updated_at, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, 'new', $8, $9::jsonb, $1, $10,
       $11, $12, NOW(), NOW(), NOW()
     )
     RETURNING *`,
    [
      userId,
      input.name.trim(),
      normalizedEmail,
      input.phone?.trim() || "",
      input.sourceType || "manual",
      input.sourceId || null,
      input.sourceLabel?.trim() || "",
      scored.score,
      JSON.stringify(scored.reasons),
      input.companyId || null,
      Math.max(0, input.budgetCents || 0),
      input.interestNotes?.trim() || "",
    ],
  );
  const lead = mapLead(result.rows[0]);
  await addCrmActivity(userId, {
    activityType: "lead_created",
    title: "Lead captured",
    detail: lead.name || lead.email,
    companyId: lead.companyId,
    metadata: { leadId: lead.id, score: lead.score },
  });
  return lead;
}

export async function updateCrmLeadStatus(
  userId: string,
  leadId: string,
  status: CrmLeadStatus,
) {
  const result = await query<DatabaseRow>(
    `UPDATE leads
     SET status = $1, status_auto_updated = FALSE, updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [status, leadId, userId],
  );
  if (!result.rows[0]) throw new Error("Lead not found");
  await addCrmActivity(userId, {
    activityType: "lead_status_changed",
    title: "Lead status changed",
    detail: `Moved to ${status.replace(/_/g, " ")}`,
    companyId: asString(result.rows[0].company_id) || null,
    metadata: { leadId, status },
  });
}

export async function createCrmPipeline(
  userId: string,
  input: { name: string; description?: string; color?: string },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Pipeline name is required");
  const result = await query<DatabaseRow>(
    `INSERT INTO pipelines (
       user_id, name, description, color, is_default, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, FALSE, NOW(), NOW())
     RETURNING id`,
    [
      userId,
      name,
      input.description?.trim() || "",
      input.color?.trim() || "#635BFF",
    ],
  );
  const pipelineId = asString(result.rows[0]?.id);
  await addCrmActivity(userId, {
    activityType: "pipeline_created",
    title: "Pipeline created",
    detail: name,
    metadata: { pipelineId },
  });
  return pipelineId;
}

export async function updateCrmPipeline(
  userId: string,
  pipelineId: string,
  input: {
    name: string;
    description?: string;
    color?: string;
    makeDefault?: boolean;
  },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Pipeline name is required");
  await query(
    `SELECT crm_update_pipeline($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      pipelineId,
      name,
      input.description?.trim() || "",
      input.color?.trim() || "#635BFF",
      Boolean(input.makeDefault),
    ],
  );
  await addCrmActivity(userId, {
    activityType: "pipeline_updated",
    title: "Pipeline updated",
    detail: name,
    metadata: { pipelineId, makeDefault: Boolean(input.makeDefault) },
  });
}

export async function deleteCrmPipeline(
  userId: string,
  pipelineId: string,
) {
  const pipeline = await query<DatabaseRow>(
    `SELECT name FROM pipelines WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [pipelineId, userId],
  );
  if (!pipeline.rows[0]) throw new Error("Pipeline not found");
  await query(`SELECT crm_delete_pipeline($1, $2)`, [userId, pipelineId]);
  await addCrmActivity(userId, {
    activityType: "pipeline_deleted",
    title: "Pipeline deleted",
    detail: asString(pipeline.rows[0].name),
    metadata: { pipelineId },
  });
}

export async function createCrmPipelineStage(
  userId: string,
  pipelineId: string,
  input: {
    name: string;
    probability?: number;
    color?: string;
    isWon?: boolean;
    isLost?: boolean;
    requiredFields?: string[];
    staleAfterDays?: number | null;
  },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Stage name is required");
  if (input.isWon && input.isLost) {
    throw new Error("A stage cannot be both Won and Lost");
  }
  const pipeline = await query<DatabaseRow>(
    `SELECT id FROM pipelines WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [pipelineId, userId],
  );
  if (!pipeline.rows[0]) throw new Error("Pipeline not found");
  const terminal = await query<DatabaseRow>(
    `SELECT COALESCE(MAX(order_index), -1)::int + 1 AS terminal_index
     FROM pipeline_stages
     WHERE pipeline_id = $1`,
    [pipelineId],
  );
  const orderIndex = asNumber(terminal.rows[0]?.terminal_index);
  const result = await query<DatabaseRow>(
    `INSERT INTO pipeline_stages (
       pipeline_id, name, order_index, probability, color, is_won, is_lost,
       required_fields, stale_after_days, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, NOW(), NOW())
     RETURNING id`,
    [
      pipelineId,
      name,
      orderIndex,
      Math.max(0, Math.min(100, input.probability ?? 25)),
      input.color || "#2563EB",
      Boolean(input.isWon),
      Boolean(input.isLost),
      input.requiredFields || [],
      input.staleAfterDays && input.staleAfterDays > 0
        ? input.staleAfterDays
        : null,
    ],
  );
  await addCrmActivity(userId, {
    activityType: "pipeline_stage_created",
    title: "Pipeline stage created",
    detail: name,
    metadata: { pipelineId, stageId: asString(result.rows[0]?.id) },
  });
}

export async function updateCrmPipelineStage(
  userId: string,
  stageId: string,
  input: {
    name: string;
    probability: number;
    color: string;
    isWon?: boolean;
    isLost?: boolean;
    requiredFields?: string[];
    staleAfterDays?: number | null;
  },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Stage name is required");
  if (input.isWon && input.isLost) {
    throw new Error("A stage cannot be both Won and Lost");
  }
  const result = await query<DatabaseRow>(
    `UPDATE pipeline_stages stage
     SET name = $1,
         probability = $2,
         color = $3,
         is_won = $4,
         is_lost = $5,
         required_fields = $6::text[],
         stale_after_days = $7,
         updated_at = NOW()
     FROM pipelines pipeline
     WHERE stage.id = $8
       AND pipeline.id = stage.pipeline_id
       AND pipeline.user_id = $9
     RETURNING stage.pipeline_id`,
    [
      name,
      Math.max(0, Math.min(100, input.probability)),
      input.color || "#2563EB",
      Boolean(input.isWon),
      Boolean(input.isLost),
      input.requiredFields || [],
      input.staleAfterDays && input.staleAfterDays > 0
        ? input.staleAfterDays
        : null,
      stageId,
      userId,
    ],
  );
  if (!result.rows[0]) throw new Error("Pipeline stage not found");
  await addCrmActivity(userId, {
    activityType: "pipeline_stage_updated",
    title: "Pipeline stage updated",
    detail: name,
    metadata: {
      pipelineId: asString(result.rows[0].pipeline_id),
      stageId,
    },
  });
}

export async function reorderCrmPipelineStage(
  userId: string,
  stageId: string,
  direction: -1 | 1,
) {
  await query(`SELECT crm_reorder_pipeline_stage($1, $2, $3)`, [
    userId,
    stageId,
    direction,
  ]);
}

export async function deleteCrmPipelineStage(
  userId: string,
  stageId: string,
  reassignStageId?: string | null,
) {
  const stage = await query<DatabaseRow>(
    `SELECT stage.name, stage.pipeline_id
     FROM pipeline_stages stage
     JOIN pipelines pipeline ON pipeline.id = stage.pipeline_id
     WHERE stage.id = $1 AND pipeline.user_id = $2
     LIMIT 1`,
    [stageId, userId],
  );
  if (!stage.rows[0]) throw new Error("Pipeline stage not found");
  const result = await query<DatabaseRow>(
    `SELECT crm_delete_pipeline_stage($1, $2, $3) AS affected_deals`,
    [userId, stageId, reassignStageId || null],
  );
  const affectedDeals = asNumber(result.rows[0]?.affected_deals);
  await addCrmActivity(userId, {
    activityType: "pipeline_stage_deleted",
    title: "Pipeline stage deleted",
    detail: asString(stage.rows[0].name),
    metadata: {
      pipelineId: asString(stage.rows[0].pipeline_id),
      stageId,
      reassignStageId: reassignStageId || null,
      affectedDeals,
    },
  });
  return affectedDeals;
}

export async function createCrmDeal(
  userId: string,
  input: {
    name: string;
    contactId?: string | null;
    companyId?: string | null;
    pipelineId: string;
    stageId: string;
    valueCents?: number;
    currency?: string;
    expectedCloseDate?: string | null;
    notes?: string;
  },
) {
  const stage = await query<DatabaseRow>(
    `SELECT stage.*
     FROM pipeline_stages stage
     JOIN pipelines pipeline ON pipeline.id = stage.pipeline_id
     WHERE stage.id = $1 AND pipeline.id = $2 AND pipeline.user_id = $3
     LIMIT 1`,
    [input.stageId, input.pipelineId, userId],
  );
  if (!stage.rows[0]) throw new Error("Choose a valid pipeline stage");
  if (asBoolean(stage.rows[0].is_won) || asBoolean(stage.rows[0].is_lost)) {
    throw new Error("Create the deal in an open stage, then close it normally");
  }
  const requiredFields = asJson<string[]>(stage.rows[0].required_fields, []);
  const missing = [
    requiredFields.includes("value") && !(input.valueCents && input.valueCents > 0)
      ? "a deal value"
      : "",
    requiredFields.includes("expected_close_date") &&
    !input.expectedCloseDate
      ? "an expected close date"
      : "",
    (requiredFields.includes("contact") ||
      requiredFields.includes("contact_id")) &&
    !input.contactId
      ? "a linked contact"
      : "",
    (requiredFields.includes("company") ||
      requiredFields.includes("company_id")) &&
    !input.companyId
      ? "a linked company"
      : "",
    requiredFields.includes("order") || requiredFields.includes("order_id")
      ? "a linked order or invoice"
      : "",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Add ${missing.join(", ")} before creating this deal in ${asString(stage.rows[0].name)}.`,
    );
  }
  const result = await query<DatabaseRow>(
    `INSERT INTO deals (
       user_id, name, contact_id, company_id, pipeline_id, stage_id,
       value_cents, currency, probability, expected_close_date, owner_id,
       notes, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $1, $11, NOW(), NOW()
     )
     RETURNING id`,
    [
      userId,
      input.name.trim(),
      input.contactId || null,
      input.companyId || null,
      input.pipelineId,
      input.stageId,
      Math.max(0, input.valueCents || 0),
      (input.currency || "USD").toUpperCase(),
      asNumber(stage.rows[0].probability),
      input.expectedCloseDate || null,
      input.notes?.trim() || "",
    ],
  );
  const dealId = asString(result.rows[0]?.id);
  await addCrmActivity(userId, {
    activityType: "deal_created",
    title: "Deal created",
    detail: input.name.trim(),
    contactId: input.contactId,
    companyId: input.companyId,
    dealId,
  });
  return dealId;
}

export async function updateCrmDealStage(
  userId: string,
  dealId: string,
  stageId: string,
  lostReason = "",
) {
  const target = await query<DatabaseRow>(
    `SELECT stage.*, pipeline.user_id
     FROM pipeline_stages stage
     JOIN pipelines pipeline ON pipeline.id = stage.pipeline_id
     WHERE stage.id = $1 AND pipeline.user_id = $2
     LIMIT 1`,
    [stageId, userId],
  );
  if (!target.rows[0]) throw new Error("Pipeline stage not found");
  const deal = await query<DatabaseRow>(
    `SELECT *
     FROM deals
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [dealId, userId],
  );
  if (!deal.rows[0]) throw new Error("Deal not found");
  if (
    asString(deal.rows[0].pipeline_id) !==
    asString(target.rows[0].pipeline_id)
  ) {
    throw new Error(
      "A deal cannot move directly to another pipeline. Clone and archive it instead.",
    );
  }
  if (asBoolean(target.rows[0].is_lost) && !lostReason.trim()) {
    throw new Error("Add a lost reason before closing this deal");
  }
  const requiredFields = asJson<string[]>(
    target.rows[0].required_fields,
    [],
  );
  const fieldChecks: Record<string, { missing: boolean; label: string }> = {
    value: {
      missing: asNumber(deal.rows[0].value_cents) <= 0,
      label: "a deal value",
    },
    expected_close_date: {
      missing: !deal.rows[0].expected_close_date,
      label: "an expected close date",
    },
    contact: {
      missing: !deal.rows[0].contact_id,
      label: "a linked contact",
    },
    contact_id: {
      missing: !deal.rows[0].contact_id,
      label: "a linked contact",
    },
    company: {
      missing: !deal.rows[0].company_id,
      label: "a linked company",
    },
    company_id: {
      missing: !deal.rows[0].company_id,
      label: "a linked company",
    },
    order: {
      missing: !deal.rows[0].order_id,
      label: "a linked order or invoice",
    },
    order_id: {
      missing: !deal.rows[0].order_id,
      label: "a linked order or invoice",
    },
    lost_reason: {
      missing: !lostReason.trim(),
      label: "a lost reason",
    },
  };
  const missing = requiredFields
    .map((field) => fieldChecks[field])
    .filter((check) => check?.missing)
    .map((check) => check.label);
  if (missing.length) {
    throw new Error(
      `Add ${missing.join(", ")} before moving this deal to ${asString(target.rows[0].name)}.`,
    );
  }
  await query(`SELECT crm_move_deal_stage($1, $2, $3, $4)`, [
    userId,
    dealId,
    stageId,
    lostReason.trim(),
  ]);
  const stageName = asString(target.rows[0].name);
  const contactId = asString(deal.rows[0].contact_id) || null;
  const dealName = asString(deal.rows[0].name);
  await addCrmActivity(userId, {
    activityType: "deal_stage_changed",
    title: "Deal stage changed",
    detail: `${dealName} moved to ${stageName}`,
    contactId,
    companyId: asString(deal.rows[0].company_id) || null,
    dealId,
    metadata: { stageId, stageName, lostReason: lostReason.trim() },
  });
  if (contactId) {
    await query(
      `INSERT INTO contact_activity (
         contact_id, user_id, activity_type, title, detail, entity_type,
         entity_id, metadata, created_at
       )
       VALUES (
         $1, $2, 'deal_stage_changed', 'Deal stage changed', $3, 'deal',
         $4, $5::jsonb, NOW()
       )`,
      [
        contactId,
        userId,
        `${dealName} moved to ${stageName}`,
        dealId,
        JSON.stringify({ stageId, stageName }),
      ],
    );
  }
}

export async function createCrmTask(
  userId: string,
  input: {
    title: string;
    description?: string;
    dueAt?: string | null;
    priority?: CrmTaskPriority;
    contactId?: string | null;
    companyId?: string | null;
    dealId?: string | null;
  },
) {
  const result = await query<DatabaseRow>(
    `INSERT INTO tasks (
       user_id, title, description, due_at, priority, status, contact_id,
       company_id, deal_id, assigned_user_id, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, 'open', $6, $7, $8, $1, NOW(), NOW()
     )
     RETURNING id`,
    [
      userId,
      input.title.trim(),
      input.description?.trim() || "",
      input.dueAt || null,
      input.priority || "normal",
      input.contactId || null,
      input.companyId || null,
      input.dealId || null,
    ],
  );
  const taskId = asString(result.rows[0]?.id);
  await addCrmActivity(userId, {
    activityType: "task_created",
    title: "Task created",
    detail: input.title.trim(),
    contactId: input.contactId,
    companyId: input.companyId,
    dealId: input.dealId,
    taskId,
  });
  return taskId;
}

export async function updateCrmTaskStatus(
  userId: string,
  taskId: string,
  status: CrmTaskStatus,
) {
  const result = await query<DatabaseRow>(
    `UPDATE tasks
     SET status = $1,
         completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING id, title, contact_id, company_id, deal_id`,
    [status, taskId, userId],
  );
  if (!result.rows[0]) throw new Error("Task not found");
  await addCrmActivity(userId, {
    activityType:
      status === "completed" ? "task_completed" : "task_status_changed",
    title: status === "completed" ? "Task completed" : "Task status changed",
    detail: asString(result.rows[0].title),
    contactId: asString(result.rows[0].contact_id) || null,
    companyId: asString(result.rows[0].company_id) || null,
    dealId: asString(result.rows[0].deal_id) || null,
    taskId,
    metadata: { status },
  });
}

export async function convertCrmLead(
  userId: string,
  leadId: string,
  target: "contact" | "company" | "deal",
  options: {
    pipelineId?: string;
    stageId?: string;
  } = {},
) {
  const leadResult = await query<DatabaseRow>(
    `SELECT * FROM leads WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [leadId, userId],
  );
  const lead = leadResult.rows[0];
  if (!lead) throw new Error("Lead not found");
  const email = asString(lead.email).trim().toLowerCase();
  if (!email) throw new Error("Add an email before converting this lead");

  let companyId = asString(lead.company_id) || null;
  if (target === "company" && !companyId) {
    const companyName =
      asString(lead.name).trim() ||
      email.split("@")[1]?.split(".")[0] ||
      "New company";
    const existingCompany = await query<DatabaseRow>(
      `SELECT id FROM companies
       WHERE user_id = $1 AND LOWER(name) = LOWER($2)
       LIMIT 1`,
      [userId, companyName],
    );
    companyId = asString(existingCompany.rows[0]?.id) || null;
    if (!companyId) {
      const company = await createCrmCompany(userId, { name: companyName });
      companyId = company.id;
    }
  }

  const existingContact = await query<DatabaseRow>(
    `SELECT id FROM contacts
     WHERE created_by = $1 AND LOWER(email) = LOWER($2)
     LIMIT 1`,
    [userId, email],
  );
  let contactId = asString(existingContact.rows[0]?.id);
  if (!contactId) {
    const inserted = await query<DatabaseRow>(
      `INSERT INTO contacts (
         email, full_name, phone, company, company_id, tags, custom_fields,
         created_by, owner_id, lifecycle_stage, source_type, source_id,
         last_activity_at, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, '', $4, '["crm-lead"]'::jsonb, '{}'::jsonb, $5, $5,
         'lead', $6, $7, NOW(), NOW(), NOW()
       )
       RETURNING id`,
      [
        email,
        asString(lead.name),
        asString(lead.phone),
        companyId,
        userId,
        asString(lead.source_type),
        lead.source_id || null,
      ],
    );
    contactId = asString(inserted.rows[0]?.id);
  } else if (companyId) {
    await query(
      `UPDATE contacts
       SET company_id = COALESCE(company_id, $1), updated_at = NOW()
       WHERE id = $2 AND created_by = $3`,
      [companyId, contactId, userId],
    );
  }

  let dealId: string | null = null;
  if (target === "deal") {
    const pipelineId =
      options.pipelineId || (await ensureDefaultCrmPipeline(userId));
    let stageId = options.stageId || "";
    if (!stageId) {
      const stage = await query<DatabaseRow>(
        `SELECT id FROM pipeline_stages
         WHERE pipeline_id = $1 AND is_won = FALSE AND is_lost = FALSE
         ORDER BY order_index
         LIMIT 1`,
        [pipelineId],
      );
      stageId = asString(stage.rows[0]?.id);
    }
    dealId = await createCrmDeal(userId, {
      name: `${asString(lead.name) || email} opportunity`,
      contactId,
      companyId,
      pipelineId,
      stageId,
      valueCents: asNumber(lead.budget_cents),
    });
  }

  await query(
    `UPDATE leads
     SET status = 'converted',
         converted_contact_id = $1,
         converted_at = NOW(),
         company_id = COALESCE(company_id, $2),
         updated_at = NOW()
     WHERE id = $3 AND user_id = $4`,
    [contactId, companyId, leadId, userId],
  );
  await addCrmActivity(userId, {
    activityType: "lead_converted",
    title: "Lead converted",
    detail: `Converted to ${target}`,
    contactId,
    companyId,
    dealId,
    metadata: { leadId, target },
  });
  return { contactId, companyId, dealId };
}


/**
 * One entry point for every CRM action. The action name arrives in the query
 * string and the arguments in the JSON body; the workspace is taken from the
 * verified session token, never from the payload.
 */
export async function handleCrmData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const action = String(url.searchParams.get("action") || "");
    const userId = await authenticatedUserId(request);
    const payload =
      request.method === "POST"
        ? await readBody(request)
        : ({} as Record<string, unknown>);

    switch (action) {
      case "ensure-default-pipeline":
        return json(response, 200, {
          result: (await ensureDefaultCrmPipeline(userId)) ?? null,
        });
      case "workspace":
        return json(response, 200, {
          result: (await getCrmWorkspace(userId)) ?? null,
        });
      case "timeline":
        return json(response, 200, {
          result:
            (await listCrmTimeline(userId, payload.input as never)) ?? null,
        });
      case "customer-360":
        return json(response, 200, {
          result:
            (await getCrmContact360(userId, payload.contactId as never)) ?? null,
        });
      case "search":
        return json(response, 200, {
          result:
            (await searchCrm(
              userId,
              String(payload.term || ""),
              Number(payload.limit || 30),
            )) ?? null,
        });
      case "create-company":
        return json(response, 200, {
          result: (await createCrmCompany(userId, payload.input as never)) ?? null,
        });
      case "create-lead":
        return json(response, 200, {
          result: (await createCrmLead(userId, payload.input as never)) ?? null,
        });
      case "update-lead-status":
        return json(response, 200, {
          result: (await updateCrmLeadStatus(userId, payload.leadId as never, payload.status as never)) ?? null,
        });
      case "create-pipeline":
        return json(response, 200, {
          result: (await createCrmPipeline(userId, payload.input as never)) ?? null,
        });
      case "update-pipeline":
        return json(response, 200, {
          result: (await updateCrmPipeline(userId, payload.pipelineId as never, payload.input as never)) ?? null,
        });
      case "delete-pipeline":
        return json(response, 200, {
          result: (await deleteCrmPipeline(userId, payload.pipelineId as never)) ?? null,
        });
      case "create-stage":
        return json(response, 200, {
          result: (await createCrmPipelineStage(userId, payload.pipelineId as never, payload.input as never)) ?? null,
        });
      case "update-stage":
        return json(response, 200, {
          result: (await updateCrmPipelineStage(userId, payload.stageId as never, payload.input as never)) ?? null,
        });
      case "reorder-stage":
        return json(response, 200, {
          result: (await reorderCrmPipelineStage(userId, payload.stageId as never, payload.direction as never)) ?? null,
        });
      case "delete-stage":
        return json(response, 200, {
          result: (await deleteCrmPipelineStage(userId, payload.stageId as never, payload.reassignStageId as never)) ?? null,
        });
      case "create-deal":
        return json(response, 200, {
          result: (await createCrmDeal(userId, payload.input as never)) ?? null,
        });
      case "update-deal-stage":
        return json(response, 200, {
          result: (await updateCrmDealStage(userId, payload.dealId as never, payload.stageId as never, payload.lostReason as never)) ?? null,
        });
      case "create-task":
        return json(response, 200, {
          result: (await createCrmTask(userId, payload.input as never)) ?? null,
        });
      case "update-task-status":
        return json(response, 200, {
          result: (await updateCrmTaskStatus(userId, payload.taskId as never, payload.status as never)) ?? null,
        });
      case "convert-lead":
        return json(response, 200, {
          result: (await convertCrmLead(userId, payload.leadId as never, payload.target as never, payload.options as never)) ?? null,
        });
      default:
        json(response, 404, { error: "This CRM action is not available." });
        return;
    }
  } catch (error) {
    if (error instanceof CrmDataError) {
      json(response, error.status, { error: error.message, code: error.code });
      return;
    }
    const message =
      error instanceof Error ? error.message : "The CRM request failed.";
    // Database exceptions raised by the CRM functions carry messages written
    // for the user ("Choose another stage for the 3 deal(s)..."), so they are
    // surfaced rather than swallowed.
    console.error("[crm-data] request failure", {
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 400, { error: message, code: "crm_failed" });
  }
}

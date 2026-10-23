/**
 * CRM client.
 *
 * Every call goes to the CRM server handler, which owns the database
 * connection. The `userId` argument is kept on each signature so callers stay
 * unchanged, but the server always derives the workspace from the session
 * token and ignores anything the client claims.
 */

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

const storedToken = () => localStorage.getItem("access_token") || "";

const crmRequest = async <T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> => {
  const token = storedToken();
  if (!token) throw new Error("Sign in again to use the CRM.");
  const response = await fetch(
    `/api/crm/data?action=${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const value = (await response.json().catch(() => ({}))) as {
    error?: string;
    result?: T;
  };
  if (!response.ok) {
    throw new Error(value.error || "The CRM request failed.");
  }
  return value.result as T;
};

export async function ensureDefaultCrmPipeline(userId: string) {
  return crmRequest("ensure-default-pipeline", {});
}

export async function getCrmWorkspace(
  userId: string,
): Promise<CrmWorkspaceData> {
  return crmRequest("workspace", {});
}

export async function getCrmTimeline(
  userId: string,
  input: {
    contactId?: string | null;
    sourceModule?: string;
    eventType?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {},
): Promise<CrmTimelineEvent[]> {
  return crmRequest("timeline", { input });
}

export async function getCrmContact360(
  userId: string,
  contactId: string,
): Promise<CrmContact360> {
  return crmRequest("customer-360", { contactId });
}

export async function searchCrm(
  userId: string,
  term: string,
  limit = 30,
): Promise<CrmSearchResult[]> {
  return crmRequest("search", { term, limit });
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
  return crmRequest("create-company", { input });
}

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
  return crmRequest("create-lead", { input });
}

export async function updateCrmLeadStatus(
  userId: string,
  leadId: string,
  status: CrmLeadStatus,
) {
  return crmRequest("update-lead-status", { leadId, status });
}

export async function createCrmPipeline(
  userId: string,
  input: { name: string; description?: string; color?: string },
) {
  return crmRequest("create-pipeline", { input });
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
  return crmRequest("update-pipeline", { pipelineId, input });
}

export async function deleteCrmPipeline(
  userId: string,
  pipelineId: string,
) {
  return crmRequest("delete-pipeline", { pipelineId });
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
  return crmRequest("create-stage", { pipelineId, input });
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
  return crmRequest("update-stage", { stageId, input });
}

export async function reorderCrmPipelineStage(
  userId: string,
  stageId: string,
  direction: -1 | 1,
) {
  return crmRequest("reorder-stage", { stageId, direction });
}

export async function deleteCrmPipelineStage(
  userId: string,
  stageId: string,
  reassignStageId?: string | null,
) {
  return crmRequest("delete-stage", { stageId, reassignStageId });
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
  return crmRequest("create-deal", { input });
}

export async function updateCrmDealStage(
  userId: string,
  dealId: string,
  stageId: string,
  lostReason = "",
) {
  return crmRequest("update-deal-stage", { dealId, stageId, lostReason });
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
  return crmRequest("create-task", { input });
}

export async function updateCrmTaskStatus(
  userId: string,
  taskId: string,
  status: CrmTaskStatus,
) {
  return crmRequest("update-task-status", { taskId, status });
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
  return crmRequest("convert-lead", { leadId, target, options });
}

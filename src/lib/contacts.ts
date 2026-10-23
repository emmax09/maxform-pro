/**
 * Contacts client.
 *
 * Every call goes to the Contacts server handler, which owns the database
 * connection. The `userId` argument stays on each signature so callers are
 * unchanged, but the server derives the workspace from the session token.
 */
import type {
  FormField,
  FormRecord,
} from "../components/forms/form-types";
import { listSecureContactPayments } from "./payments";

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

// Return types mirror the server implementation exactly. This is a type-only
// import, erased at build time, so no server code reaches the browser.
import type {
  listContacts as RawlistContacts,
  getContact as RawgetContact,
  createContact as RawcreateContact,
  updateContact as RawupdateContact,
  deleteContacts as RawdeleteContacts,
  mergeContacts as RawmergeContacts,
  addContactActivity as RawaddContactActivity,
  listContactActivity as RawlistContactActivity,
  listContactNotes as RawlistContactNotes,
  createContactNote as RawcreateContactNote,
  listContactLists as RawlistContactLists,
  saveContactList as RawsaveContactList,
  deleteContactList as RawdeleteContactList,
  addContactsToList as RawaddContactsToList,
  removeContactsFromList as RawremoveContactsFromList,
  listFormListMappings as RawlistFormListMappings,
  saveFormListMapping as RawsaveFormListMapping,
  deleteFormListMapping as RawdeleteFormListMapping,
  listContactCustomFields as RawlistContactCustomFields,
  createContactCustomField as RawcreateContactCustomField,
  updateContactCustomField as RawupdateContactCustomField,
  deleteContactCustomField as RawdeleteContactCustomField,
  listContactCampaigns as RawlistContactCampaigns,
  listCampaignSuppressions as RawlistCampaignSuppressions,
  saveContactCampaign as RawsaveContactCampaign,
  scheduleContactCampaign as RawscheduleContactCampaign,
  deleteContactCampaign as RawdeleteContactCampaign,
  bulkUpdateContactCampaigns as RawbulkUpdateContactCampaigns,
  duplicateContactCampaign as RawduplicateContactCampaign,
  sendContactCampaignNow as RawsendContactCampaignNow,
  pauseContactCampaign as RawpauseContactCampaign,
  resumeContactCampaign as RawresumeContactCampaign,
  archiveContactCampaign as RawarchiveContactCampaign,
  removeCampaignSuppressions as RawremoveCampaignSuppressions,
  deleteCampaignSuppressionsFromSystem as RawdeleteCampaignSuppressionsFromSystem,
  getCampaignAudiencePreview as RawgetCampaignAudiencePreview,
  sendCampaignTest as RawsendCampaignTest,
  getCampaignAnalytics as RawgetCampaignAnalytics,
  getCampaignClickMap as RawgetCampaignClickMap,
  getCampaignPerformanceOverview as RawgetCampaignPerformanceOverview,
  listCampaignVariants as RawlistCampaignVariants,
  saveCampaignAbTest as RawsaveCampaignAbTest,
  getCampaignSettings as RawgetCampaignSettings,
  saveCampaignSettings as RawsaveCampaignSettings,
  getContactCrmSettings as RawgetContactCrmSettings,
  saveContactCrmSettings as RawsaveContactCrmSettings,
  importContacts as RawimportContacts,
  syncSubmissionContact as RawsyncSubmissionContact,
  listContactPayments as RawlistContactPayments,
} from "../../server/contacts-data";

type ServerlistContacts = Awaited<ReturnType<typeof RawlistContacts>>;
type ServergetContact = Awaited<ReturnType<typeof RawgetContact>>;
type ServercreateContact = Awaited<ReturnType<typeof RawcreateContact>>;
type ServerupdateContact = Awaited<ReturnType<typeof RawupdateContact>>;
type ServerdeleteContacts = Awaited<ReturnType<typeof RawdeleteContacts>>;
type ServermergeContacts = Awaited<ReturnType<typeof RawmergeContacts>>;
type ServeraddContactActivity = Awaited<ReturnType<typeof RawaddContactActivity>>;
type ServerlistContactActivity = Awaited<ReturnType<typeof RawlistContactActivity>>;
type ServerlistContactNotes = Awaited<ReturnType<typeof RawlistContactNotes>>;
type ServercreateContactNote = Awaited<ReturnType<typeof RawcreateContactNote>>;
type ServerlistContactLists = Awaited<ReturnType<typeof RawlistContactLists>>;
type ServersaveContactList = Awaited<ReturnType<typeof RawsaveContactList>>;
type ServerdeleteContactList = Awaited<ReturnType<typeof RawdeleteContactList>>;
type ServeraddContactsToList = Awaited<ReturnType<typeof RawaddContactsToList>>;
type ServerremoveContactsFromList = Awaited<ReturnType<typeof RawremoveContactsFromList>>;
type ServerlistFormListMappings = Awaited<ReturnType<typeof RawlistFormListMappings>>;
type ServersaveFormListMapping = Awaited<ReturnType<typeof RawsaveFormListMapping>>;
type ServerdeleteFormListMapping = Awaited<ReturnType<typeof RawdeleteFormListMapping>>;
type ServerlistContactCustomFields = Awaited<ReturnType<typeof RawlistContactCustomFields>>;
type ServercreateContactCustomField = Awaited<ReturnType<typeof RawcreateContactCustomField>>;
type ServerupdateContactCustomField = Awaited<ReturnType<typeof RawupdateContactCustomField>>;
type ServerdeleteContactCustomField = Awaited<ReturnType<typeof RawdeleteContactCustomField>>;
type ServerlistContactCampaigns = Awaited<ReturnType<typeof RawlistContactCampaigns>>;
export type CampaignSuppressionPage = Awaited<ReturnType<typeof RawlistCampaignSuppressions>>;
export type CampaignSuppressionRecord = CampaignSuppressionPage["rows"][number];
export type CampaignSuppressionReason = CampaignSuppressionRecord["reason"];
type ServersaveContactCampaign = Awaited<ReturnType<typeof RawsaveContactCampaign>>;
type ServerscheduleContactCampaign = Awaited<ReturnType<typeof RawscheduleContactCampaign>>;
type ServerdeleteContactCampaign = Awaited<ReturnType<typeof RawdeleteContactCampaign>>;
export type ContactCampaignBulkResult = Awaited<ReturnType<typeof RawbulkUpdateContactCampaigns>>;
type ServerduplicateContactCampaign = Awaited<ReturnType<typeof RawduplicateContactCampaign>>;
type ServersendContactCampaignNow = Awaited<ReturnType<typeof RawsendContactCampaignNow>>;
type ServerpauseContactCampaign = Awaited<ReturnType<typeof RawpauseContactCampaign>>;
type ServerresumeContactCampaign = Awaited<ReturnType<typeof RawresumeContactCampaign>>;
type ServerarchiveContactCampaign = Awaited<ReturnType<typeof RawarchiveContactCampaign>>;
export type CampaignSuppressionRemovalResult = Awaited<ReturnType<typeof RawremoveCampaignSuppressions>>;
export type CampaignSuppressionSystemDeletionResult = Awaited<ReturnType<typeof RawdeleteCampaignSuppressionsFromSystem>>;
type ServergetCampaignAudiencePreview = Awaited<ReturnType<typeof RawgetCampaignAudiencePreview>>;
type ServersendCampaignTest = Awaited<ReturnType<typeof RawsendCampaignTest>>;
type ServergetCampaignAnalytics = Awaited<ReturnType<typeof RawgetCampaignAnalytics>>;
type ServergetCampaignClickMap = Awaited<ReturnType<typeof RawgetCampaignClickMap>>;
type ServergetCampaignPerformanceOverview = Awaited<ReturnType<typeof RawgetCampaignPerformanceOverview>>;
export type CampaignOverviewRange = "7d" | "1w" | "1m" | "3m" | "6m" | "1y";
type ServerlistCampaignVariants = Awaited<ReturnType<typeof RawlistCampaignVariants>>;
type ServersaveCampaignAbTest = Awaited<ReturnType<typeof RawsaveCampaignAbTest>>;
type ServergetCampaignSettings = Awaited<ReturnType<typeof RawgetCampaignSettings>>;
type ServersaveCampaignSettings = Awaited<ReturnType<typeof RawsaveCampaignSettings>>;
type ServergetContactCrmSettings = Awaited<ReturnType<typeof RawgetContactCrmSettings>>;
type ServersaveContactCrmSettings = Awaited<ReturnType<typeof RawsaveContactCrmSettings>>;
type ServerimportContacts = Awaited<ReturnType<typeof RawimportContacts>>;
type ServersyncSubmissionContact = Awaited<ReturnType<typeof RawsyncSubmissionContact>>;
type ServerlistContactPayments = Awaited<ReturnType<typeof RawlistContactPayments>>;

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
export type ContactCampaignBulkAction = "archive" | "delete" | "pause" | "resume";

export type ContactCampaign = {
  id: string;
  name: string;
  listId: string;
  listName: string;
  /** All selected CRM lists. listId is retained as the first-list legacy field. */
  listIds?: string[];
  audienceMode?: CampaignAudienceMode;
  customRecipients?: string[];
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

export type CampaignClickMapEntry = {
  blockId: string;
  label: string;
  url: string;
  clickCount: number;
  uniqueClickCount: number;
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

export const defaultContactCrmSettings: ContactCrmSettings = {
  deduplicationMode: "email",
  lifecycleStages: ["lead", "contacted", "customer", "past_customer"],
  unsubscribeFooter:
    "You can unsubscribe from marketing emails at any time.",
};

const storedToken = () => localStorage.getItem("access_token") || "";

const dataRequest = async <T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(
    `/api/contacts/data?action=${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${storedToken()}`,
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
    throw new Error(value.error || "This request failed.");
  }
  return value.result as T;
};

export async function listContacts(
  userId: string,
  options: {
    search?: string;
    lifecycle?: string;
    listId?: string;
    limit?: number;
  } = {},
): Promise<ServerlistContacts> {
  return dataRequest("list-contacts", { options });
}

export async function getContact(userId: string, contactId: string): Promise<ServergetContact> {
  return dataRequest("get-contact", { contactId });
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
): Promise<ServercreateContact> {
  return dataRequest("create-contact", { input });
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
  }>,
): Promise<ServerupdateContact> {
  return dataRequest("update-contact", { contactId, input });
}

export async function deleteContacts(userId: string, contactIds: string[]): Promise<ServerdeleteContacts> {
  return dataRequest("delete-contacts", { contactIds });
}

export async function mergeContacts(
  userId: string,
  winnerContactId: string,
  mergedContactId: string,
): Promise<ServermergeContacts> {
  return dataRequest("merge-contacts", { winnerContactId, mergedContactId });
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
): Promise<ServeraddContactActivity> {
  return dataRequest("add-contact-activity", { contactId, input });
}

export async function listContactActivity(
  userId: string,
  contactId: string,
): Promise<ServerlistContactActivity> {
  return dataRequest("list-contact-activity", { contactId });
}

export async function listContactNotes(userId: string, contactId: string): Promise<ServerlistContactNotes> {
  return dataRequest("list-contact-notes", { contactId });
}

export async function createContactNote(
  userId: string,
  contactId: string,
  body: string,
): Promise<ServercreateContactNote> {
  return dataRequest("create-contact-note", { contactId, body });
}

export async function listContactLists(
  userId: string,
  listType?: "static" | "dynamic",
): Promise<ServerlistContactLists> {
  return dataRequest("list-contact-lists", { listType });
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
): Promise<ServersaveContactList> {
  return dataRequest("save-contact-list", { input });
}

export async function deleteContactList(userId: string, listId: string): Promise<ServerdeleteContactList> {
  return dataRequest("delete-contact-list", { listId });
}

export async function addContactsToList(
  userId: string,
  listId: string,
  contactIds: string[],
  sourceType = "manual",
  sourceId?: string,
): Promise<ServeraddContactsToList> {
  return dataRequest("add-contacts-to-list", { listId, contactIds, sourceType, sourceId });
}

export async function removeContactsFromList(
  userId: string,
  listId: string,
  contactIds: string[],
): Promise<ServerremoveContactsFromList> {
  return dataRequest("remove-contacts-from-list", { listId, contactIds });
}

export async function listFormListMappings(
  userId: string,
  formId: string,
): Promise<ServerlistFormListMappings> {
  return dataRequest("list-form-list-mappings", { formId });
}

export async function saveFormListMapping(
  userId: string,
  input: {
    formId: string;
    listId: string;
    matchMode: "email" | "email_phone";
    fieldMapping: Record<string, string>;
  },
): Promise<ServersaveFormListMapping> {
  return dataRequest("save-form-list-mapping", { input });
}

export async function deleteFormListMapping(
  userId: string,
  mappingId: string,
): Promise<ServerdeleteFormListMapping> {
  return dataRequest("delete-form-list-mapping", { mappingId });
}

export async function listContactCustomFields(userId: string): Promise<ServerlistContactCustomFields> {
  return dataRequest("list-contact-custom-fields", {});
}

export async function createContactCustomField(
  userId: string,
  input: Omit<ContactCustomField, "id" | "createdAt" | "fieldKey"> & {
    fieldKey?: string;
  },
): Promise<ServercreateContactCustomField> {
  return dataRequest("create-contact-custom-field", { input });
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
): Promise<ServerupdateContactCustomField> {
  return dataRequest("update-contact-custom-field", { fieldId, input });
}

export async function deleteContactCustomField(
  userId: string,
  fieldId: string,
): Promise<ServerdeleteContactCustomField> {
  return dataRequest("delete-contact-custom-field", { fieldId });
}

export async function listContactCampaigns(userId: string): Promise<ServerlistContactCampaigns> {
  return dataRequest("list-contact-campaigns", {});
}

export async function listCampaignSuppressions(
  userId: string,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
    reason?: CampaignSuppressionReason | "all";
  } = {},
): Promise<CampaignSuppressionPage> {
  return dataRequest("list-campaign-suppressions", { options });
}

export async function removeCampaignSuppressions(
  userId: string,
  suppressionIds: string[],
): Promise<CampaignSuppressionRemovalResult> {
  return dataRequest("remove-campaign-suppressions", { suppressionIds });
}

export async function deleteCampaignSuppressionsFromSystem(
  userId: string,
  suppressionIds: string[],
): Promise<CampaignSuppressionSystemDeletionResult> {
  return dataRequest("delete-campaign-suppressions-from-system", {
    suppressionIds,
  });
}

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
): Promise<ServersaveContactCampaign> {
  return dataRequest("save-contact-campaign", { input });
}

export async function scheduleContactCampaign(
  userId: string,
  campaignId: string,
  scheduledAt: string,
  options: {
    sendStrategy?: string;
    recurrenceRule?: string;
    recurrenceRequiresReview?: boolean;
  } = {},
): Promise<ServerscheduleContactCampaign> {
  return dataRequest("schedule-contact-campaign", {
    campaignId,
    scheduledAt,
    options,
  });
}

export async function deleteContactCampaign(
  userId: string,
  campaignId: string,
): Promise<ServerdeleteContactCampaign> {
  return dataRequest("delete-contact-campaign", { campaignId });
}

export async function bulkUpdateContactCampaigns(
  userId: string,
  campaignIds: string[],
  action: ContactCampaignBulkAction,
): Promise<ContactCampaignBulkResult> {
  return dataRequest("bulk-update-contact-campaigns", { campaignIds, action });
}

export async function duplicateContactCampaign(
  userId: string,
  campaignId: string,
): Promise<ServerduplicateContactCampaign> {
  return dataRequest("duplicate-contact-campaign", { campaignId });
}

export async function sendContactCampaignNow(
  userId: string,
  campaignId: string,
): Promise<ServersendContactCampaignNow> {
  return dataRequest("send-contact-campaign-now", { campaignId });
}

export async function pauseContactCampaign(
  userId: string,
  campaignId: string,
): Promise<ServerpauseContactCampaign> {
  return dataRequest("pause-contact-campaign", { campaignId });
}

export async function resumeContactCampaign(
  userId: string,
  campaignId: string,
  /** Omit to pick up a paused send where its waves stopped. */
  scheduledAt?: string,
): Promise<ServerresumeContactCampaign> {
  return dataRequest("resume-contact-campaign", { campaignId, scheduledAt });
}

export async function archiveContactCampaign(
  userId: string,
  campaignId: string,
): Promise<ServerarchiveContactCampaign> {
  return dataRequest("archive-contact-campaign", { campaignId });
}

export async function getCampaignAudiencePreview(
  userId: string,
  input: {
    audienceMode?: CampaignAudienceMode;
    listIds?: string[];
    listId?: string;
    excludeListId?: string | null;
    customRecipients?: string[];
  },
): Promise<ServergetCampaignAudiencePreview> {
  return dataRequest("campaign-audience-preview", { input });
}

export async function sendCampaignTest(
  userId: string,
  campaignId: string,
  recipient: string,
): Promise<ServersendCampaignTest> {
  return dataRequest("send-campaign-test", { campaignId, recipient });
}

export async function getCampaignAnalytics(
  userId: string,
  campaignId: string,
): Promise<ServergetCampaignAnalytics> {
  return dataRequest("campaign-analytics", { campaignId });
}

export async function getCampaignClickMap(
  userId: string,
  campaignId: string,
): Promise<ServergetCampaignClickMap> {
  return dataRequest("campaign-click-map", { campaignId });
}

export async function getCampaignPerformanceOverview(
  userId: string,
  range: CampaignOverviewRange = "7d",
): Promise<ServergetCampaignPerformanceOverview> {
  return dataRequest("campaign-performance-overview", { range });
}

export async function listCampaignVariants(
  userId: string,
  campaignId: string,
): Promise<ServerlistCampaignVariants> {
  return dataRequest("list-campaign-variants", { campaignId });
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
): Promise<ServersaveCampaignAbTest> {
  return dataRequest("save-campaign-ab-test", { campaignId, input });
}

/* ---------------- Campaigns v2: builder and send wizard ---------------- */

export type CampaignPacing = {
  provider: string;
  batchSize: number;
  batchDelaySeconds: number;
  batchCount: number;
  estimatedDurationSeconds: number;
  summary: string;
};

export type CampaignWizardIdentity = {
  id: string;
  senderName: string;
  senderEmail: string;
  replyTo: string;
  sendingMode: "managed" | "custom";
  customDomain: string;
  domainVerified: boolean;
  domainVerificationStatus: "not_required" | "pending" | "verified" | "failed";
  senderReady: boolean;
  verified: boolean;
};

export type CampaignWizardIdentities = {
  selectedIdentityId: string | null;
  identities: CampaignWizardIdentity[];
};

export type CampaignSendProgress = {
  campaignId: string;
  status: string;
  batchSize: number;
  batchDelaySeconds: number;
  estimatedSendDurationSeconds: number;
  estimatedDurationSummary: string;
  totalRecipients: number;
  sent: number;
  failed: number;
  pending: number;
  batchesTotal: number;
  batchesSent: number;
  nextBatchAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

/** Autosave from the full-screen builder. */
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
): Promise<{ savedAt: string }> {
  return dataRequest("save-campaign-builder-state", { campaignId, input });
}

/** Save & Continue: hands a finished design to the send wizard. */
export async function completeCampaignBuilder(
  userId: string,
  campaignId: string,
): Promise<{ builderState: "ready_to_send" }> {
  return dataRequest("complete-campaign-builder", { campaignId });
}

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
): Promise<{
  audience: ServergetCampaignAudiencePreview;
  pacing: CampaignPacing;
}> {
  return dataRequest("campaign-wizard-recipients", { campaignId, input });
}

export async function getCampaignWizardIdentities(
  userId: string,
  campaignId: string,
): Promise<CampaignWizardIdentities> {
  return dataRequest("campaign-wizard-identities", { campaignId });
}

export async function saveCampaignWizardIdentity(
  userId: string,
  campaignId: string,
  input: {
    identityId?: string | null;
  },
): Promise<CampaignWizardIdentities> {
  return dataRequest("campaign-wizard-identity", { campaignId, input });
}

export type CampaignWizardReview = {
  campaign: ContactCampaign;
  audience: ServergetCampaignAudiencePreview | null;
  identity: CampaignWizardIdentity | null;
  pacing: CampaignPacing;
  settings: ContactCampaignSettings;
  blockers: string[];
  canSend: boolean;
};

export async function getCampaignWizardReview(
  userId: string,
  campaignId: string,
): Promise<CampaignWizardReview> {
  return dataRequest("campaign-wizard-review", { campaignId });
}

export async function scheduleCampaignFromWizard(
  userId: string,
  campaignId: string,
  input: {
    strategy?: string;
    scheduledAt?: string;
    recurrenceRule?: string;
    recurrenceRequiresReview?: boolean;
  },
): Promise<{ queued: number; strategy: string; scheduledAt: string | null }> {
  return dataRequest("campaign-wizard-schedule", { campaignId, input });
}

/** Live batch progress for a sending campaign. */
export async function getCampaignSendProgress(
  userId: string,
  campaignId: string,
): Promise<CampaignSendProgress> {
  return dataRequest("campaign-send-progress", { campaignId });
}

export async function getCampaignSettings(
  userId: string,
): Promise<ServergetCampaignSettings> {
  return dataRequest("get-campaign-settings", {});
}

export async function saveCampaignSettings(
  userId: string,
  settings: ContactCampaignSettings,
): Promise<ServersaveCampaignSettings> {
  return dataRequest("save-campaign-settings", { settings });
}

export async function getContactCrmSettings(userId: string): Promise<ServergetContactCrmSettings> {
  return dataRequest("get-contact-crm-settings", {});
}

export async function saveContactCrmSettings(
  userId: string,
  settings: ContactCrmSettings,
): Promise<ServersaveContactCrmSettings> {
  return dataRequest("save-contact-crm-settings", { settings });
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
): Promise<ServerimportContacts> {
  return dataRequest("import-contacts", { fileName, listId, rows });
}

export async function syncSubmissionContact(
  form: FormRecord,
  submissionId: string,
  answers: Record<string, unknown>,
): Promise<ServersyncSubmissionContact> {
  return dataRequest("sync-submission-contact", { form, submissionId, answers });
}

export async function listContactPayments(
  userId: string,
  contactEmail: string,
): Promise<ServerlistContactPayments> {
  return dataRequest("list-contact-payments", { contactEmail });
}

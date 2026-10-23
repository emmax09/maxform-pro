import { deleteAccount } from "./auth";

export interface ProfileSettings {
  avatarUrl: string | null;
  bio: string;
  company: string;
  country: string;
  fullName: string;
  jobTitle: string;
  phone: string;
}

export interface WorkspaceSettings {
  address: string;
  addressLine1: string;
  addressLine2: string;
  brandColor: string;
  city: string;
  companyLogoUrl: string | null;
  companyName: string;
  companySize: string;
  companyWebsite: string;
  country: string;
  industry: string;
  phone: string;
  postalCode: string;
  stateRegion: string;
}

export interface WorkspaceRegionalSettings {
  currency: string;
  currencyCountryCode: string | null;
  timezone: string;
}

export interface NotificationSettings {
  dailyDigest: boolean;
  emailOnNewSubmission: boolean;
  emailOnPaymentReceived: boolean;
  emailOnWorkflowTrigger: boolean;
}

export type WorkspaceRole = "admin" | "moderator" | "user";

export interface PendingInvitation {
  createdAt: string;
  email: string;
  expiresAt: string;
  id: string;
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  email: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  jobTitle: string;
  role: "owner" | WorkspaceRole;
  status: "active" | "suspended";
  /** `null` means every module, which is what an owner or admin gets. */
  allowedModules: string[] | null;
  isOwner: boolean;
  /** The system-generated password has not been replaced yet. */
  pendingCredentials: boolean;
  /** Barred from signing in anywhere, not merely paused in this workspace. */
  blocked: boolean;
  /** This workspace created the account, so it may also block or delete it. */
  provisioned: boolean;
  credentialsSentAt: string;
  /** Last recorded sign-in. Empty when they have never signed in. */
  lastActiveAt: string;
  createdAt: string;
}

export interface MemberCredentials {
  username: string;
  email: string;
  password: string;
}

export interface MemberMutationResult {
  members: WorkspaceMember[];
  /** Present only on the response that generated them. Never retrievable later. */
  credentials?: MemberCredentials | null;
  emailDelivered?: boolean;
  emailError?: string;
  reusedAccount?: boolean;
}

export interface UsageStats {
  forms: number;
  responses: number;
  workflows: number;
  contacts: number;
  subscription: {
    plan: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    extraStorageBytes: number;
    extraEmails: number;
    cancelAtPeriodEnd: boolean;
  };
  storage: { usedBytes: number };
  /** `ownProvider` are sends delivered through the workspace's own provider. */
  emails: { sent: number; ownProvider: number };
  credits: {
    balance: number;
    spentThisPeriod: number;
    purchased: number;
    breakdown: Array<{ action: string; credits: number; runs: number }>;
  };
  billingHistory: Array<{
    id: string;
    kind: string;
    description: string;
    amountCents: number;
    currency: string;
    status: string;
    createdAt: string;
  }>;
}

const settingsRequest = async <T>(
  action: string,
  input: { body?: object; params?: Record<string, string> } = {},
) => {
  const token = localStorage.getItem("access_token") || "";
  // Built through URLSearchParams rather than by concatenation: the action is
  // encoded, so an extra query string appended to it would arrive as part of
  // the action name instead of as its own parameter.
  const query = new URLSearchParams({ action, ...(input.params || {}) });
  const response = await fetch(
    `/api/settings?${query.toString()}`,
    {
      method: input.body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    },
  );
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      result.error || "Workspace settings could not be updated.",
    );
  }
  return result;
};

let workspaceSettingsRequest:
  | {
      promise: Promise<WorkspaceSettings>;
      userId: string;
    }
  | undefined;

export async function updateProfileSettings(
  userId: string,
  settings: ProfileSettings,
) {
  void userId;
  await settingsRequest("profile", { body: settings });
}

export async function getWorkspaceSettings(
  userId: string,
): Promise<WorkspaceSettings> {
  if (workspaceSettingsRequest?.userId === userId) {
    return workspaceSettingsRequest.promise;
  }
  const promise = settingsRequest<{ workspace: WorkspaceSettings }>(
    "workspace",
  ).then((result) => result.workspace);
  workspaceSettingsRequest = { promise, userId };
  void promise.finally(() => {
    window.setTimeout(() => {
      if (workspaceSettingsRequest?.promise === promise) {
        workspaceSettingsRequest = undefined;
      }
    }, 5_000);
  });
  return promise;
}

export async function saveWorkspaceSettings(
  userId: string,
  settings: WorkspaceSettings,
) {
  void userId;
  const result = await settingsRequest<{ workspace: WorkspaceSettings }>(
    "workspace",
    { body: settings },
  );
  workspaceSettingsRequest = {
    promise: Promise.resolve(result.workspace),
    userId,
  };
  return result.workspace;
}

export async function getWorkspaceRegionalSettings(
  userId: string,
  country?: string | null,
): Promise<WorkspaceRegionalSettings> {
  void userId;
  void country;
  const result = await settingsRequest<{
    regional: WorkspaceRegionalSettings;
  }>("regional");
  return result.regional;
}

export async function saveWorkspaceRegionalSettings(
  userId: string,
  settings: WorkspaceRegionalSettings,
) {
  void userId;
  const result = await settingsRequest<{
    regional: WorkspaceRegionalSettings;
  }>("regional", { body: settings });
  return result.regional;
}

export async function getNotificationSettings(
  userId: string,
): Promise<NotificationSettings> {
  void userId;
  const result = await settingsRequest<{
    notifications: NotificationSettings;
  }>("notifications");
  return result.notifications;
}

export async function saveNotificationSettings(
  userId: string,
  settings: NotificationSettings,
) {
  void userId;
  await settingsRequest("notifications", { body: settings });
}

export async function getPendingInvitations(
  userId: string,
): Promise<PendingInvitation[]> {
  void userId;
  const result = await settingsRequest<{
    invitations: PendingInvitation[];
  }>("invitations");
  return result.invitations;
}

export async function createInvitation(
  userId: string,
  email: string,
  role: WorkspaceRole,
) {
  void userId;
  await settingsRequest("invitations", { body: { email, role } });
}

export async function revokeInvitation(userId: string, invitationId: string) {
  void userId;
  await settingsRequest("revoke-invitation", {
    body: { id: invitationId },
  });
}

export async function getWorkspaceMembers(): Promise<WorkspaceMember[]> {
  const result = await settingsRequest<{ members: WorkspaceMember[] }>(
    "members",
  );
  return result.members;
}

export async function addWorkspaceMember(input: {
  email: string;
  fullName: string;
  jobTitle?: string;
  role: WorkspaceRole;
  modules: string[];
  /** Leave empty to have one generated. */
  username?: string;
  /** Leave empty to have one generated and marked temporary. */
  password?: string;
}): Promise<MemberMutationResult> {
  return settingsRequest<MemberMutationResult>("add-member", { body: input });
}

export async function updateWorkspaceMember(input: {
  memberId: string;
  role: WorkspaceRole;
  modules: string[];
  status: "active" | "suspended";
  fullName?: string;
  jobTitle?: string;
  email?: string;
  username?: string;
}): Promise<MemberMutationResult> {
  return settingsRequest<MemberMutationResult>("update-member", {
    body: input,
  });
}

/** The owner choosing a password directly, rather than generating one. */
export async function setMemberPassword(input: {
  memberId: string;
  password: string;
  notify?: boolean;
}): Promise<MemberMutationResult> {
  return settingsRequest<MemberMutationResult>("set-member-password", {
    body: input,
  });
}

/** Account-level: refuses sign-in everywhere, and ends live sessions. */
export async function setMemberBlocked(
  memberId: string,
  blocked: boolean,
): Promise<MemberMutationResult> {
  return settingsRequest<MemberMutationResult>("block-member", {
    body: { memberId, blocked },
  });
}

export interface MemberActivityEvent {
  id: string;
  action: string;
  /** Ready to display: "Signed in", "Role changed", and so on. */
  label: string;
  memberLabel: string;
  actorLabel: string;
  /** The member did it themselves rather than having it done to them. */
  bySelf: boolean;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface MemberActivityResult {
  member: { id: string; fullName: string; email: string };
  events: MemberActivityEvent[];
}

/** One member's audit trail, newest first. Owner and admins only. */
export async function getMemberActivity(
  memberId: string,
): Promise<MemberActivityResult> {
  return settingsRequest<MemberActivityResult>("member-activity", {
    params: { memberId },
  });
}

/** Deletes the account itself. Only allowed for accounts this workspace created. */
export async function deleteMemberAccount(
  memberId: string,
): Promise<MemberMutationResult> {
  return settingsRequest<MemberMutationResult>("delete-member-account", {
    body: { memberId },
  });
}

export async function removeWorkspaceMember(
  memberId: string,
): Promise<MemberMutationResult> {
  return settingsRequest<MemberMutationResult>("remove-member", {
    body: { memberId },
  });
}

export async function resetMemberCredentials(
  memberId: string,
): Promise<MemberMutationResult> {
  return settingsRequest<MemberMutationResult>("reset-member-credentials", {
    body: { memberId },
  });
}

export async function getUsageStats(userId: string): Promise<UsageStats> {
  void userId;
  const result = await settingsRequest<{ usage: UsageStats }>("usage");
  return result.usage;
}

export async function deleteUserAccount(
  userId: string,
  currentPassword: string,
) {
  void userId;
  await deleteAccount(currentPassword);
}

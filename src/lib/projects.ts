export type ProjectStatus = "active" | "archived";
export type ProjectItemKind = "form" | "workflow" | "event";
export type ProjectItemView = "forms" | "workflows" | "events" | "files";

export type ProjectAccessMember = {
  email: string;
  id: string;
  name: string;
  role: string;
  scoped: boolean;
  state: "member" | "invited";
};

export type ProjectSummary = {
  access: ProjectAccessMember[];
  archivedAt: string | null;
  color: string;
  createdAt: string;
  description: string;
  eventCount: number;
  fileCount: number;
  formCount: number;
  icon: string;
  id: string;
  lastActiveAt: string;
  name: string;
  status: ProjectStatus;
  updatedAt: string;
  workflowCount: number;
};

export type ProjectActivityEntry = {
  at: string;
  id: string;
  kind: "response" | "registration" | "payment" | "file";
  subtitle: string;
  title: string;
};

export type ProjectOverview = {
  activity: ProjectActivityEntry[];
  currency: string;
  eventCount: number;
  fileCount: number;
  formCount: number;
  registrationsThisMonth: number;
  responsesThisMonth: number;
  revenueThisMonth: number;
  workflowCount: number;
};

export type ProjectItem = {
  id: string;
  meta: string;
  status: string;
  title: string;
  updatedAt: string;
};

export type AssignableItem = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
};

export type ProjectsVisibility = {
  projectCount: number;
  reason:
    | "hidden"
    | "multiple_projects"
    | "scoped_invitation"
    | "scoped_member";
  scopedInvitations: number;
  visible: boolean;
};

/** The fixed icon and color sets the server accepts; the picker renders these. */
export const PROJECT_ICONS = [
  "folder",
  "briefcase",
  "rocket",
  "megaphone",
  "ticket",
  "sparkles",
  "building",
  "target",
  "flag",
  "calendar",
] as const;

export const PROJECT_COLORS = [
  "blue",
  "violet",
  "emerald",
  "amber",
  "rose",
  "cyan",
  "orange",
  "slate",
] as const;

export type ProjectIcon = (typeof PROJECT_ICONS)[number];
export type ProjectColor = (typeof PROJECT_COLORS)[number];

const storedToken = () => localStorage.getItem("access_token") || "";

const request = async <T>(
  action: string,
  input: {
    body?: Record<string, unknown>;
    search?: Record<string, string>;
  } = {},
) => {
  const token = storedToken();
  if (!token) throw new Error("Sign in again to open projects.");
  const search = new URLSearchParams({ action, ...(input.search || {}) });
  const response = await fetch(`/api/projects/data?${search.toString()}`, {
    method: input.body ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error || "Projects are temporarily unavailable.");
  }
  return result;
};

export const listProjects = () =>
  request<{ projects: ProjectSummary[] }>("list");

/**
 * Reports whether a workspace has passed the point where projects start to
 * matter — a second project, or an invitation scoped to one. The rail entry is
 * shown unconditionally, so nothing gates on this today; it stays because the
 * server action backs it and it is the check to read if the rail ever becomes
 * conditional again.
 */
export const getProjectsVisibility = () =>
  request<ProjectsVisibility>("visibility");

export const getProject = (projectId: string) =>
  request<{ project: ProjectSummary }>("detail", { search: { projectId } });

export const getProjectOverview = (projectId: string) =>
  request<{ overview: ProjectOverview }>("overview", { search: { projectId } });

export const listProjectItems = (projectId: string, kind: ProjectItemView) =>
  request<{ items: ProjectItem[] }>("items", { search: { kind, projectId } });

export const listAssignableItems = (kind: ProjectItemKind) =>
  request<{ items: AssignableItem[] }>("assignable", { search: { kind } });

export const listProjectAccess = (projectId: string) =>
  request<{ members: ProjectAccessMember[] }>("access", {
    search: { projectId },
  });

export const createProject = (input: {
  color?: string;
  description?: string;
  icon?: string;
  name: string;
}) => request<{ project: ProjectSummary }>("create", { body: input });

export const updateProject = (input: {
  color: string;
  description: string;
  icon: string;
  id: string;
  name: string;
}) => request<{ project: ProjectSummary }>("update", { body: input });

export const archiveProject = (id: string) =>
  request<{ project: ProjectSummary }>("archive", { body: { id } });

export const restoreProject = (id: string) =>
  request<{ project: ProjectSummary }>("restore", { body: { id } });

export const deleteProject = (id: string, confirmName: string) =>
  request<{
    deleted: boolean;
    unassigned: { events: number; forms: number; workflows: number };
  }>("delete", { body: { confirmName, id } });

/** Deletes a confirmed selection in one server transaction. */
export const deleteProjects = (projects: Array<{ id: string; name: string }>) =>
  request<{
    deleted: number;
    unassigned: { events: number; forms: number; workflows: number };
  }>("delete-many", { body: { projects } });

export const setProjectsStatus = (ids: string[], status: ProjectStatus) =>
  request<{ updated: number; status: ProjectStatus }>("status-many", {
    body: { ids, status },
  });

export const assignItemToProject = (
  kind: ProjectItemKind,
  itemId: string,
  projectId: string | null,
) =>
  request<{ itemId: string; kind: string; projectId: string | null }>("assign", {
    body: { itemId, kind, projectId },
  });

export const inviteToProject = (
  projectId: string,
  email: string,
  role: string,
) =>
  request<{ members: ProjectAccessMember[] }>("invite", {
    body: { email, projectId, role },
  });

export const revokeProjectAccess = (projectId: string, invitationId: string) =>
  request<{ members: ProjectAccessMember[] }>("revoke-access", {
    body: { invitationId, projectId },
  });

import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import { workspaceScopeFor } from "./workspace-access";

/**
 * The signed-in account behind the current request, kept apart from the
 * workspace whose rows that request reads.
 *
 * Everywhere else in this file `userId` means the workspace -- that is what
 * `created_by` is compared against. Project scoping and the row-level security
 * policies, though, are properties of the *person*: a member restricted to two
 * projects is restricted wherever they look. This store carries that person
 * through the call stack so neither meaning has to be threaded by hand through
 * twenty-odd functions.
 *
 * When it is empty -- a call arriving from another module rather than from the
 * Projects API -- the workspace id is used, which is the right answer for an
 * owner and the same behaviour this file had before members existed.
 */
const projectActor = new AsyncLocalStorage<string>();

const actingUserId = (workspaceId: string) =>
  projectActor.getStore() || workspaceId;

type DatabaseRow = Record<string, unknown>;
type RecordValue = Record<string, unknown>;

export type ProjectStatus = "active" | "archived";
export type ProjectItemKind = "form" | "workflow" | "event";

export type ProjectAccessMember = {
  email: string;
  id: string;
  name: string;
  role: string;
  scoped: boolean;
  state: "member" | "invited";
};

export type ProjectSummary = {
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
  access: ProjectAccessMember[];
};

export type ProjectOverview = {
  activity: Array<{
    at: string;
    id: string;
    kind: "response" | "registration" | "payment" | "file";
    subtitle: string;
    title: string;
  }>;
  currency: string;
  eventCount: number;
  fileCount: number;
  formCount: number;
  registrationsThisMonth: number;
  responsesThisMonth: number;
  revenueThisMonth: number;
  workflowCount: number;
};

class ProjectsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "projects_error",
  ) {
    super(message);
  }
}

/** Kept to a fixed set so a project card always renders a known glyph. */
const PROJECT_ICONS = [
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

const PROJECT_COLORS = [
  "blue",
  "violet",
  "emerald",
  "amber",
  "rose",
  "cyan",
  "orange",
  "slate",
] as const;

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new ProjectsError(
      "Projects are temporarily unavailable.",
      503,
      "projects_unavailable",
    );
  }
  return neon(url);
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new ProjectsError(
      "Projects are temporarily unavailable.",
      503,
      "projects_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const text = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

const count = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

const amount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const json = (response: ServerResponse, status: number, value: RecordValue) => {
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
    throw new ProjectsError(
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
    if (!isUuid(userId)) throw new Error("Invalid user");
    return userId;
  } catch (error) {
    if (error instanceof ProjectsError) throw error;
    throw new ProjectsError(
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
    if (body.length > 24_000) {
      throw new ProjectsError("This project request is too large.", 413);
    }
  }
  if (!body) return {} as RecordValue;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid request");
    }
    return value as RecordValue;
  } catch {
    throw new ProjectsError("This project request could not be read.");
  }
};

/**
 * Runs a query with the caller identified to Postgres for the length of one
 * transaction, which is what the row-level security policies on `projects` and
 * `workspace_members` read. `set_config(..., true)` is transaction-local, so
 * nothing leaks into the next request on a pooled connection -- verified
 * against the driver rather than assumed.
 *
 * Every project read and write goes through here. The policies are inert while
 * the application connects as a BYPASSRLS role (see migration 097), so today
 * this is belt for a suspenders that is not yet buckled -- but it costs one
 * statement and means activating RLS is a credentials change, not a rewrite.
 */
const withProjectAccess = async (
  userId: string,
  statement: string,
  parameters: unknown[] = [],
) => {
  const sql = database();
  const actor = actingUserId(userId);
  const results = await sql.transaction((transaction) => [
    transaction`SELECT set_config('app.current_user_id', ${actor}, true)`,
    // .query() rather than a tagged template: the statement is composed above
    // with numbered placeholders, which is the driver's other calling form.
    transaction.query(statement, parameters),
  ]);
  return (results[1] as DatabaseRow[]) || [];
};

/**
 * The single choke point for project visibility.
 *
 * NULL means unrestricted -- the default for the workspace owner. A non-empty
 * array restricts the caller to exactly those projects, and an empty array
 * means the caller has been scoped out of every project. Every read below
 * passes through applyScope() so a new query cannot accidentally skip the
 * check.
 *
 * Membership is the source of truth. The invitation fallback covers a
 * workspace whose members predate the membership table and have not signed in
 * since; it is the same rule read from the older record.
 */
export const projectScopeFor = async (
  userId: string,
): Promise<string[] | null> => {
  const sql = database();
  // Scope belongs to the person, not the workspace, so this reads the acting
  // account rather than the workspace it is looking at.
  const actor = actingUserId(userId);
  const memberRows = await withProjectAccess(
    actor,
    `SELECT project_scope
     FROM workspace_members
     WHERE user_id = $1
       AND status = 'active'
     ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, created_at
     LIMIT 1`,
    [actor],
  );
  const member = memberRows[0] as DatabaseRow | undefined;
  if (member) {
    const scope = member.project_scope;
    if (!Array.isArray(scope)) return null;
    return scope.map((value) => String(value)).filter(isUuid);
  }

  const rows = await sql.query(
    `SELECT invitation.project_scope
     FROM invitations invitation
     JOIN users invited ON LOWER(invited.email) = LOWER(invitation.email)
     WHERE invited.id = $1
       AND invitation.status = 'accepted'
       AND invitation.project_scope IS NOT NULL
     ORDER BY invitation.created_at DESC
     LIMIT 1`,
    [actor],
  );
  const scope = (rows[0] as DatabaseRow | undefined)?.project_scope;
  if (!Array.isArray(scope)) return null;
  return scope.map((value) => String(value)).filter(isUuid);
};

/**
 * Resolves a caller-supplied project id to one they may actually file work
 * into, or null. Used by the Forms and Events create paths so an id arriving
 * over RPC can never drop a record into someone else's folder.
 */
export const resolveOwnedProjectId = async (
  userId: string,
  projectId: unknown,
): Promise<string | null> => {
  const id = text(projectId, 36);
  if (!isUuid(id)) return null;
  const scope = await projectScopeFor(userId);
  if (scope !== null && !scope.includes(id)) return null;
  const rows = await withProjectAccess(
    userId,
    `SELECT id FROM projects WHERE id = $1 AND created_by = $2 LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? text(rows[0].id, 36) : null;
};

/** Narrows a project query to the caller's scope without duplicating SQL. */
const applyScope = (
  scope: string[] | null,
  column: string,
  parameters: unknown[],
) => {
  if (scope === null) return "";
  if (scope.length === 0) return " AND FALSE";
  parameters.push(scope);
  return ` AND ${column} = ANY($${parameters.length}::uuid[])`;
};

const assertScopeAllows = (scope: string[] | null, projectId: string) => {
  if (scope === null) return;
  if (!scope.includes(projectId)) {
    throw new ProjectsError(
      "This project is not available in your workspace.",
      404,
      "project_not_found",
    );
  }
};

const normalizeIcon = (value: unknown) => {
  const icon = text(value, 24).toLowerCase();
  return (PROJECT_ICONS as readonly string[]).includes(icon) ? icon : "folder";
};

const normalizeColor = (value: unknown) => {
  const color = text(value, 24).toLowerCase();
  return (PROJECT_COLORS as readonly string[]).includes(color) ? color : "blue";
};

const normalizeName = (value: unknown) => {
  const name = text(value, 120);
  if (!name) throw new ProjectsError("Give this project a name.");
  return name;
};

const projectIdFrom = (value: unknown) => {
  const id = text(value, 36);
  if (!isUuid(id)) {
    throw new ProjectsError("This project was not found.", 404, "project_not_found");
  }
  return id;
};

/**
 * Counts deliberately exclude event registration forms. They are an internal
 * detail of an event, and showing them beside the event that owns them would
 * make every event project read as though it held twice the work it does.
 */
const projectRowsSql = (scopeClause: string) => `
  SELECT project.id,
         project.name,
         COALESCE(project.description, '') AS description,
         project.icon,
         project.color,
         project.status,
         project.archived_at,
         project.created_at,
         project.updated_at,
         (
           SELECT COUNT(*)
           FROM forms form
           WHERE form.project_id = project.id
             AND form.created_by = project.created_by
             AND NOT EXISTS (
               SELECT 1 FROM events event
               WHERE event.registration_form_id = form.id
             )
         )::int AS form_count,
         (
           SELECT COUNT(*)
           FROM workflows workflow
           WHERE workflow.project_id = project.id
             AND workflow.created_by = project.created_by
         )::int AS workflow_count,
         (
           SELECT COUNT(*)
           FROM events event
           WHERE event.project_id = project.id
             AND event.created_by = project.created_by
         )::int AS event_count,
         -- Must match listProjectItems('files') exactly, or the card count and
         -- the tab it opens would disagree.
         (
           SELECT COUNT(*)
           FROM workspace_files file
           JOIN form_submissions submission ON submission.id = file.source_id
           JOIN forms form ON form.id = submission.form_id
           WHERE file.user_id = project.created_by
             AND file.deleted_at IS NULL
             AND file.source_type IN ('form_upload', 'event_upload')
             AND (
               form.project_id = project.id
               OR EXISTS (
                 SELECT 1 FROM events event
                 WHERE event.registration_form_id = form.id
                   AND event.project_id = project.id
               )
             )
         )::int
         + (
           SELECT COUNT(*)
           FROM workspace_files file
           JOIN workspace_documents document ON document.id = file.source_id
           JOIN payment_orders "order" ON "order".id = document.order_id
           WHERE file.user_id = project.created_by
             AND file.deleted_at IS NULL
             AND file.source_type = 'document'
             AND (
               (
                 "order".source_type = 'form'
                 AND EXISTS (
                   SELECT 1 FROM forms form
                   WHERE form.id = "order".source_id
                     AND form.project_id = project.id
                 )
               )
               OR (
                 "order".source_type = 'event'
                 AND EXISTS (
                   SELECT 1 FROM events event
                   WHERE event.id = "order".source_id
                     AND event.project_id = project.id
                 )
               )
             )
         )::int AS file_count,
         GREATEST(
           project.updated_at,
           COALESCE((
             SELECT MAX(form.updated_at) FROM forms form
             WHERE form.project_id = project.id
           ), project.updated_at),
           COALESCE((
             SELECT MAX(event.updated_at) FROM events event
             WHERE event.project_id = project.id
           ), project.updated_at),
           COALESCE((
             SELECT MAX(workflow.updated_at) FROM workflows workflow
             WHERE workflow.project_id = project.id
           ), project.updated_at)
         ) AS last_active_at
  FROM projects project
  WHERE project.created_by = $1${scopeClause}
`;

const projectFor = (
  row: DatabaseRow,
  access: ProjectAccessMember[],
): ProjectSummary => ({
  access,
  archivedAt: row.archived_at ? String(row.archived_at) : null,
  color: normalizeColor(row.color),
  createdAt: String(row.created_at || ""),
  description: text(row.description, 500),
  eventCount: count(row.event_count),
  fileCount: count(row.file_count),
  formCount: count(row.form_count),
  icon: normalizeIcon(row.icon),
  id: text(row.id, 36),
  lastActiveAt: String(row.last_active_at || row.updated_at || ""),
  name: text(row.name, 120),
  status: row.status === "archived" ? "archived" : "active",
  updatedAt: String(row.updated_at || ""),
  workflowCount: count(row.workflow_count),
});

/**
 * Who can see a project: the owner, who is never scoped out of their own
 * workspace, plus anyone invited directly into it.
 */
const accessByProject = async (userId: string, projectIds: string[]) => {
  const grouped = new Map<string, ProjectAccessMember[]>();
  if (projectIds.length === 0) return grouped;

  const sql = database();
  const [ownerRows, invitationRows] = await Promise.all([
    sql.query(
      `SELECT users.id, users.email, COALESCE(profile.full_name, users.full_name) AS full_name
       FROM users
       LEFT JOIN profiles profile ON profile.user_id = users.id
       WHERE users.id = $1
       LIMIT 1`,
      [userId],
    ),
    sql.query(
      `SELECT invitation.id, invitation.email, invitation.role,
              invitation.status, invitation.project_scope
       FROM invitations invitation
       WHERE invitation.invited_by = $1
         AND invitation.status IN ('pending', 'accepted')
         AND invitation.project_scope && $2::uuid[]
       ORDER BY invitation.created_at DESC`,
      [userId, projectIds],
    ),
  ]);

  const owner = ownerRows[0] as DatabaseRow | undefined;
  const ownerMember: ProjectAccessMember = {
    email: text(owner?.email, 255),
    id: text(owner?.id, 36),
    name: text(owner?.full_name, 160) || "Workspace owner",
    role: "owner",
    scoped: false,
    state: "member",
  };

  projectIds.forEach((projectId) => grouped.set(projectId, [ownerMember]));

  invitationRows.forEach((row) => {
    const invitation = row as DatabaseRow;
    const scope = Array.isArray(invitation.project_scope)
      ? invitation.project_scope.map((value) => String(value))
      : [];
    const member: ProjectAccessMember = {
      email: text(invitation.email, 255),
      id: text(invitation.id, 36),
      name: text(invitation.email, 255).split("@")[0] || "Invited member",
      role: text(invitation.role, 40) || "user",
      scoped: true,
      state: invitation.status === "accepted" ? "member" : "invited",
    };
    scope.forEach((projectId) => {
      const members = grouped.get(projectId);
      if (members) members.push(member);
    });
  });

  return grouped;
};

export const listProjects = async (userId: string) => {
  const scope = await projectScopeFor(userId);
  const parameters: unknown[] = [userId];
  const scopeClause = applyScope(scope, "project.id", parameters);
  const rows = await withProjectAccess(
    userId,
    `${projectRowsSql(scopeClause)} ORDER BY last_active_at DESC, project.created_at DESC`,
    parameters,
  );
  const ids = rows.map((row) => text((row as DatabaseRow).id, 36));
  const access = await accessByProject(userId, ids);
  return {
    projects: rows.map((row) =>
      projectFor(row as DatabaseRow, access.get(text((row as DatabaseRow).id, 36)) || []),
    ),
  };
};

export const getProject = async (userId: string, projectId: string) => {
  const scope = await projectScopeFor(userId);
  assertScopeAllows(scope, projectId);
  const rows = await withProjectAccess(
    userId,
    `${projectRowsSql("")} AND project.id = $2 LIMIT 1`,
    [userId, projectId],
  );
  const row = rows[0] as DatabaseRow | undefined;
  if (!row) {
    throw new ProjectsError("This project was not found.", 404, "project_not_found");
  }
  const access = await accessByProject(userId, [projectId]);
  return { project: projectFor(row, access.get(projectId) || []) };
};

export const createProject = async (userId: string, input: RecordValue) => {
  const scope = await projectScopeFor(userId);
  if (scope !== null) {
    throw new ProjectsError(
      "Your access is limited to specific projects, so you cannot create new ones.",
      403,
      "project_scope_restricted",
    );
  }
  const name = normalizeName(input.name);
  const rows = await withProjectAccess(
    userId,
    `INSERT INTO projects (name, description, icon, color, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', $5, NOW(), NOW())
     RETURNING id`,
    [
      name,
      text(input.description, 500) || null,
      normalizeIcon(input.icon),
      normalizeColor(input.color),
      userId,
    ],
  );
  return getProject(userId, text((rows[0] as DatabaseRow).id, 36));
};

export const updateProject = async (userId: string, input: RecordValue) => {
  const projectId = projectIdFrom(input.id);
  const scope = await projectScopeFor(userId);
  assertScopeAllows(scope, projectId);
  const rows = await withProjectAccess(
    userId,
    `UPDATE projects
     SET name = $1,
         description = $2,
         icon = $3,
         color = $4,
         updated_at = NOW()
     WHERE id = $5 AND created_by = $6
     RETURNING id`,
    [
      normalizeName(input.name),
      text(input.description, 500) || null,
      normalizeIcon(input.icon),
      normalizeColor(input.color),
      projectId,
      userId,
    ],
  );
  if (!rows[0]) {
    throw new ProjectsError("This project was not found.", 404, "project_not_found");
  }
  return getProject(userId, projectId);
};

export const setProjectStatus = async (
  userId: string,
  projectId: string,
  status: ProjectStatus,
) => {
  const scope = await projectScopeFor(userId);
  assertScopeAllows(scope, projectId);
  const rows = await withProjectAccess(
    userId,
    `UPDATE projects
     SET status = $1,
         archived_at = CASE WHEN $1 = 'archived' THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $2 AND created_by = $3
     RETURNING id`,
    [status, projectId, userId],
  );
  if (!rows[0]) {
    throw new ProjectsError("This project was not found.", 404, "project_not_found");
  }
  return getProject(userId, projectId);
};

/**
 * Deleting a folder must never destroy the work inside it. Every form,
 * workflow, and event is unassigned first and reappears in the main module
 * lists; only then is the project row removed. Both halves run in one
 * transaction so a failure cannot leave orphaned rows pointing at a project
 * that is already gone.
 */
export const deleteProject = async (
  userId: string,
  projectId: string,
  confirmName: string,
) => {
  const scope = await projectScopeFor(userId);
  assertScopeAllows(scope, projectId);
  const sql = database();
  const rows = await withProjectAccess(
    userId,
    `SELECT id, name FROM projects WHERE id = $1 AND created_by = $2 LIMIT 1`,
    [projectId, userId],
  );
  const project = rows[0] as DatabaseRow | undefined;
  if (!project) {
    throw new ProjectsError("This project was not found.", 404, "project_not_found");
  }
  if (
    text(confirmName, 120).toLowerCase() !== text(project.name, 120).toLowerCase()
  ) {
    throw new ProjectsError(
      "Type the project name exactly to confirm deletion.",
      400,
      "project_confirmation_mismatch",
    );
  }

  const unassigned = await sql.transaction((transaction) => [
    transaction`SELECT set_config('app.current_user_id', ${userId}, true)`,
    transaction`UPDATE forms SET project_id = NULL, updated_at = NOW()
                WHERE project_id = ${projectId} AND created_by = ${userId}
                RETURNING id`,
    transaction`UPDATE workflows SET project_id = NULL, updated_at = NOW()
                WHERE project_id = ${projectId} AND created_by = ${userId}
                RETURNING id`,
    transaction`UPDATE events SET project_id = NULL, updated_at = NOW()
                WHERE project_id = ${projectId} AND created_by = ${userId}
                RETURNING id`,
    transaction`DELETE FROM projects
                WHERE id = ${projectId} AND created_by = ${userId}
                RETURNING id`,
  ]);

  // Index 0 is the set_config call that identifies the caller to the policies.
  const [, forms, workflows, events] = unassigned as DatabaseRow[][];
  return {
    deleted: true,
    unassigned: {
      events: events?.length || 0,
      forms: forms?.length || 0,
      workflows: workflows?.length || 0,
    },
  };
};

/**
 * Deletes a selected project set atomically. Names are checked against the
 * current rows before the transaction starts, so a stale selection cannot
 * silently remove a renamed project. As with single-project deletion, only
 * the folder is removed; its forms, workflows, and events are unassigned.
 */
export const deleteProjects = async (
  userId: string,
  requested: Array<{ id: string; name: string }>,
) => {
  const entries = Array.from(
    new Map<string, { id: string; name: string }>(
      requested
        .map((entry) => ({
          id: text(entry?.id, 36),
          name: text(entry?.name, 120),
        }))
        .filter((entry) => isUuid(entry.id) && entry.name)
        .map((entry) => [entry.id, entry] as const),
    ).values(),
  );
  if (!entries.length) {
    throw new ProjectsError("Select at least one project.", 400, "projects_required");
  }
  if (entries.length > 100) {
    throw new ProjectsError("Select no more than 100 projects at a time.", 400, "projects_limit");
  }

  const scope = await projectScopeFor(userId);
  entries.forEach((entry) => assertScopeAllows(scope, entry.id));
  const ids = entries.map((entry) => entry.id);
  const rows = await withProjectAccess(
    userId,
    `SELECT id, name
     FROM projects
     WHERE created_by = $1 AND id = ANY($2::uuid[])`,
    [userId, ids],
  );
  if (rows.length !== entries.length) {
    throw new ProjectsError("One or more selected projects are no longer available.", 404, "project_not_found");
  }
  const namesById = new Map(
    rows.map((row) => [text(row.id, 36), text(row.name, 120).toLowerCase()]),
  );
  if (
    entries.some(
      (entry) => namesById.get(entry.id) !== entry.name.toLowerCase(),
    )
  ) {
    throw new ProjectsError(
      "One or more selected projects changed. Refresh the list and try again.",
      409,
      "project_selection_stale",
    );
  }

  const sql = database();
  const results = await sql.transaction((transaction) => [
    transaction`SELECT set_config('app.current_user_id', ${userId}, true)`,
    transaction.query(
      `UPDATE forms SET project_id = NULL, updated_at = NOW()
       WHERE project_id = ANY($1::uuid[]) AND created_by = $2
       RETURNING id`,
      [ids, userId],
    ),
    transaction.query(
      `UPDATE workflows SET project_id = NULL, updated_at = NOW()
       WHERE project_id = ANY($1::uuid[]) AND created_by = $2
       RETURNING id`,
      [ids, userId],
    ),
    transaction.query(
      `UPDATE events SET project_id = NULL, updated_at = NOW()
       WHERE project_id = ANY($1::uuid[]) AND created_by = $2
       RETURNING id`,
      [ids, userId],
    ),
    transaction.query(
      `DELETE FROM projects
       WHERE id = ANY($1::uuid[]) AND created_by = $2
       RETURNING id`,
      [ids, userId],
    ),
  ]);
  const [, forms, workflows, events, deleted] = results as DatabaseRow[][];
  if (deleted.length !== entries.length) {
    throw new ProjectsError("The selected projects could not be deleted.", 409, "project_delete_conflict");
  }
  return {
    deleted: deleted.length,
    unassigned: {
      events: events?.length || 0,
      forms: forms?.length || 0,
      workflows: workflows?.length || 0,
    },
  };
};

export const setProjectsStatus = async (
  userId: string,
  requestedIds: string[],
  status: ProjectStatus,
) => {
  const ids = Array.from(new Set(requestedIds.map((id) => text(id, 36))))
    .filter(isUuid)
    .slice(0, 100);
  if (!ids.length) {
    throw new ProjectsError("Select at least one project.", 400, "projects_required");
  }
  const scope = await projectScopeFor(userId);
  ids.forEach((id) => assertScopeAllows(scope, id));
  const rows = await withProjectAccess(
    userId,
    `SELECT id FROM projects WHERE created_by = $1 AND id = ANY($2::uuid[])`,
    [userId, ids],
  );
  if (rows.length !== ids.length) {
    throw new ProjectsError("One or more selected projects are no longer available.", 404, "project_not_found");
  }
  const sql = database();
  const updated = await sql.transaction((transaction) => [
    transaction`SELECT set_config('app.current_user_id', ${userId}, true)`,
    transaction.query(
      `UPDATE projects
       SET status = $1,
           archived_at = CASE WHEN $1 = 'archived' THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE id = ANY($2::uuid[]) AND created_by = $3
       RETURNING id`,
      [status, ids, userId],
    ),
  ]);
  const result = (updated[1] as DatabaseRow[]) || [];
  if (result.length !== ids.length) {
    throw new ProjectsError("The selected projects could not be updated.", 409, "project_status_conflict");
  }
  return { updated: result.length, status };
};

export const getProjectOverview = async (
  userId: string,
  projectId: string,
): Promise<ProjectOverview> => {
  const scope = await projectScopeFor(userId);
  assertScopeAllows(scope, projectId);
  const sql = database();
  const [summaryRows, activityRows] = await Promise.all([
    sql.query(
      `WITH workspace_currency AS (
         SELECT COALESCE(
           (SELECT currency FROM workspace_regional_settings WHERE user_id = $1 LIMIT 1),
           'USD'
         ) AS currency
       ),
       project_forms AS (
         SELECT form.id, form.project_id
         FROM forms form
         WHERE form.created_by = $1
           AND form.project_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM events event
             WHERE event.registration_form_id = form.id
           )
       ),
       project_events AS (
         SELECT event.id, event.registration_form_id
         FROM events event
         WHERE event.created_by = $1 AND event.project_id = $2
       ),
       month_responses AS (
         SELECT COUNT(*)::int AS value
         FROM form_submissions submission
         JOIN project_forms form ON form.id = submission.form_id
         WHERE submission.submitted_at >= date_trunc('month', NOW())
           AND COALESCE(submission.data #>> '{_meta,status}', 'completed')
             <> 'pending_payment'
       ),
       month_registrations AS (
         SELECT COUNT(*)::int AS value
         FROM event_attendees attendee
         JOIN project_events event ON event.id = attendee.event_id
         WHERE attendee.created_at >= date_trunc('month', NOW())
           AND attendee.ticket_status = 'valid'
       ),
       /*
        * Revenue uses the same definition as Analytics, Payments, and Home:
        * payment_orders, net of refunds, in the workspace currency, dated by
        * paid_at. A project's revenue has to be a slice of the workspace
        * number, not a second opinion computed a different way.
        */
       month_revenue AS (
         SELECT COALESCE(SUM(
                  GREATEST("order".total_amount - "order".refunded_amount, 0)
                ), 0)::numeric AS value
         FROM payment_orders "order"
         CROSS JOIN workspace_currency
         WHERE "order".user_id = $1
           AND "order".status IN ('paid', 'partially_refunded', 'refunded')
           AND "order".currency = workspace_currency.currency
           AND "order".paid_at >= date_trunc('month', NOW())
           AND (
             (
               "order".source_type = 'form'
               AND "order".source_id IN (SELECT id FROM project_forms)
             )
             OR (
               "order".source_type = 'event'
               AND "order".source_id IN (SELECT id FROM project_events)
             )
           )
       )
       SELECT (SELECT currency FROM workspace_currency) AS currency,
              (SELECT value FROM month_responses) AS responses_this_month,
              (SELECT value FROM month_registrations) AS registrations_this_month,
              (SELECT value FROM month_revenue) AS revenue_this_month`,
      [userId, projectId],
    ),
    sql.query(
      `WITH project_forms AS (
         SELECT form.id, form.title
         FROM forms form
         WHERE form.created_by = $1
           AND form.project_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM events event
             WHERE event.registration_form_id = form.id
           )
       ),
       project_events AS (
         SELECT event.id, event.title
         FROM events event
         WHERE event.created_by = $1 AND event.project_id = $2
       )
       SELECT * FROM (
         SELECT submission.id::text AS id,
                'response' AS kind,
                COALESCE(NULLIF(form.title, ''), 'Untitled form') AS title,
                'New response' AS subtitle,
                submission.submitted_at AS at
         FROM form_submissions submission
         JOIN project_forms form ON form.id = submission.form_id
         WHERE COALESCE(submission.data #>> '{_meta,status}', 'completed')
           <> 'pending_payment'
         UNION ALL
         SELECT attendee.id::text,
                'registration',
                COALESCE(NULLIF(event.title, ''), 'Untitled event'),
                'New registration',
                attendee.created_at
         FROM event_attendees attendee
         JOIN project_events event ON event.id = attendee.event_id
         WHERE attendee.ticket_status = 'valid'
         UNION ALL
         SELECT "order".id::text,
                'payment',
                COALESCE(
                  NULLIF(event.title, ''),
                  NULLIF(form.title, ''),
                  'Untitled'
                ),
                'Payment received',
                "order".paid_at
         FROM payment_orders "order"
         LEFT JOIN project_events event
           ON "order".source_type = 'event' AND event.id = "order".source_id
         LEFT JOIN project_forms form
           ON "order".source_type = 'form' AND form.id = "order".source_id
         WHERE "order".user_id = $1
           AND "order".status IN ('paid', 'partially_refunded', 'refunded')
           AND "order".paid_at IS NOT NULL
           AND (event.id IS NOT NULL OR form.id IS NOT NULL)
         UNION ALL
         SELECT file.id::text,
                'file',
                file.name,
                'File received',
                file.created_at
         FROM workspace_files file
         JOIN form_submissions submission ON submission.id = file.source_id
         JOIN project_forms form ON form.id = submission.form_id
         WHERE file.user_id = $1
           AND file.deleted_at IS NULL
           AND file.source_type IN ('form_upload', 'event_upload')
       ) feed
       ORDER BY at DESC
       LIMIT 12`,
      [userId, projectId],
    ),
  ]);

  const counts = await withProjectAccess(
    userId,
    `${projectRowsSql("")} AND project.id = $2 LIMIT 1`,
    [userId, projectId],
  );
  const countRow = (counts[0] as DatabaseRow | undefined) || {};
  const summary = (summaryRows[0] as DatabaseRow | undefined) || {};

  return {
    activity: activityRows.map((row) => {
      const item = row as DatabaseRow;
      return {
        at: String(item.at || ""),
        id: text(item.id, 64),
        kind: text(item.kind, 20) as ProjectOverview["activity"][number]["kind"],
        subtitle: text(item.subtitle, 120),
        title: text(item.title, 180),
      };
    }),
    currency: text(summary.currency, 3) || "USD",
    eventCount: count(countRow.event_count),
    fileCount: count(countRow.file_count),
    formCount: count(countRow.form_count),
    registrationsThisMonth: count(summary.registrations_this_month),
    responsesThisMonth: count(summary.responses_this_month),
    revenueThisMonth: amount(summary.revenue_this_month),
    workflowCount: count(countRow.workflow_count),
  };
};

/**
 * The Forms / Workflows / Events / Files tabs inside a project. These are the
 * same records the main modules list, filtered to this project -- each row
 * deep-links back into the module that owns it rather than forking a second
 * copy of the builder.
 */
export const listProjectItems = async (
  userId: string,
  projectId: string,
  kind: string,
) => {
  const scope = await projectScopeFor(userId);
  assertScopeAllows(scope, projectId);
  const sql = database();

  if (kind === "forms") {
    const rows = await sql.query(
      `SELECT form.id, form.slug, form.title, form.status, form.updated_at,
              (
                SELECT COUNT(*)
                FROM form_submissions submission
                WHERE submission.form_id = form.id
                  AND COALESCE(submission.data #>> '{_meta,status}', 'completed')
                    <> 'pending_payment'
              )::int AS response_count
       FROM forms form
       WHERE form.created_by = $1
         AND form.project_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM events event WHERE event.registration_form_id = form.id
         )
       ORDER BY form.updated_at DESC
       LIMIT 200`,
      [userId, projectId],
    );
    return {
      items: rows.map((row) => {
        const item = row as DatabaseRow;
        return {
          id: text(item.id, 36),
          meta: `${count(item.response_count)} response${
            count(item.response_count) === 1 ? "" : "s"
          }`,
          status: text(item.status, 30) || "draft",
          title: text(item.title, 180) || "Untitled form",
          updatedAt: String(item.updated_at || ""),
        };
      }),
    };
  }

  if (kind === "workflows") {
    const rows = await sql.query(
      `SELECT workflow.id, workflow.name, workflow.enabled, workflow.updated_at,
              COALESCE(NULLIF(form.title, ''), 'Unlinked form') AS form_title,
              (
                SELECT COUNT(*) FROM automation_runs run
                WHERE run.workflow_id = workflow.id
              )::int AS run_count
       FROM workflows workflow
       LEFT JOIN forms form ON form.id = workflow.form_id
       WHERE workflow.created_by = $1
         AND workflow.project_id = $2
       ORDER BY workflow.updated_at DESC
       LIMIT 200`,
      [userId, projectId],
    );
    return {
      items: rows.map((row) => {
        const item = row as DatabaseRow;
        return {
          id: text(item.id, 36),
          meta: `${text(item.form_title, 180)} - ${count(item.run_count)} run${
            count(item.run_count) === 1 ? "" : "s"
          }`,
          status: item.enabled === false ? "paused" : "active",
          title: text(item.name, 180) || "Untitled workflow",
          updatedAt: String(item.updated_at || ""),
        };
      }),
    };
  }

  if (kind === "events") {
    const rows = await sql.query(
      `SELECT event.id, event.title, event.status, event.starts_at, event.updated_at,
              (
                SELECT COUNT(*) FROM event_attendees attendee
                WHERE attendee.event_id = event.id
                  AND attendee.ticket_status = 'valid'
              )::int AS attendee_count
       FROM events event
       WHERE event.created_by = $1
         AND event.project_id = $2
       ORDER BY event.updated_at DESC
       LIMIT 200`,
      [userId, projectId],
    );
    return {
      items: rows.map((row) => {
        const item = row as DatabaseRow;
        return {
          id: text(item.id, 36),
          meta: `${count(item.attendee_count)} attendee${
            count(item.attendee_count) === 1 ? "" : "s"
          }`,
          status: text(item.status, 30) || "draft",
          title: text(item.title, 180) || "Untitled event",
          updatedAt: String(item.starts_at || item.updated_at || ""),
        };
      }),
    };
  }

  if (kind === "files") {
    // Uploads reach a project through the form that collected them. Signed
    // documents reach it through the order that produced them, which is the
    // only real link this schema has between a document and a form or event.
    const rows = await sql.query(
      `SELECT file.id, file.name, file.size_bytes, file.source_type,
              file.created_at,
              COALESCE(NULLIF(file.source_label, ''), form.title, 'Workspace file')
                AS source_label
       FROM workspace_files file
       JOIN form_submissions submission ON submission.id = file.source_id
       JOIN forms form ON form.id = submission.form_id
       WHERE file.user_id = $1
         AND file.deleted_at IS NULL
         AND file.source_type IN ('form_upload', 'event_upload')
         AND (
           form.project_id = $2
           OR EXISTS (
             SELECT 1 FROM events event
             WHERE event.registration_form_id = form.id
               AND event.project_id = $2
           )
         )
       UNION ALL
       SELECT file.id, file.name, file.size_bytes, file.source_type,
              file.created_at,
              COALESCE(NULLIF(file.source_label, ''), document.title, 'Document')
                AS source_label
       FROM workspace_files file
       JOIN workspace_documents document ON document.id = file.source_id
       JOIN payment_orders "order" ON "order".id = document.order_id
       WHERE file.user_id = $1
         AND file.deleted_at IS NULL
         AND file.source_type = 'document'
         AND (
           (
             "order".source_type = 'form'
             AND EXISTS (
               SELECT 1 FROM forms form
               WHERE form.id = "order".source_id AND form.project_id = $2
             )
           )
           OR (
             "order".source_type = 'event'
             AND EXISTS (
               SELECT 1 FROM events event
               WHERE event.id = "order".source_id AND event.project_id = $2
             )
           )
         )
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId, projectId],
    );
    return {
      items: rows.map((row) => {
        const item = row as DatabaseRow;
        const bytes = count(item.size_bytes);
        const size =
          bytes >= 1_048_576
            ? `${(bytes / 1_048_576).toFixed(1)} MB`
            : `${Math.max(1, Math.round(bytes / 1024))} KB`;
        return {
          id: text(item.id, 36),
          meta: `${size} - ${text(item.source_label, 180)}`,
          status: text(item.source_type, 30),
          title: text(item.name, 255) || "Untitled file",
          updatedAt: String(item.created_at || ""),
        };
      }),
    };
  }

  throw new ProjectsError("This project view is not available.", 404);
};

const assignableFor = (row: unknown) => {
  const item = row as DatabaseRow;
  return {
    id: text(item.id, 36),
    projectId: item.project_id ? text(item.project_id, 36) : null,
    projectName: text(item.project_name, 120) || null,
    title: text(item.title, 180) || "Untitled",
  };
};

/** Items the owner can still add to a project: unassigned, or filed elsewhere. */
export const listAssignableItems = async (userId: string, kind: string) => {
  const sql = database();
  if (kind === "form") {
    const rows = await withProjectAccess(
      userId,
      `SELECT form.id, form.title, form.project_id, project.name AS project_name
       FROM forms form
       LEFT JOIN projects project ON project.id = form.project_id
       WHERE form.created_by = $1
         AND NOT EXISTS (
           SELECT 1 FROM events event WHERE event.registration_form_id = form.id
         )
       ORDER BY form.updated_at DESC
       LIMIT 300`,
      [userId],
    );
    return { items: rows.map(assignableFor) };
  }
  if (kind === "workflow") {
    const rows = await withProjectAccess(
      userId,
      `SELECT workflow.id, workflow.name AS title, workflow.project_id,
              project.name AS project_name
       FROM workflows workflow
       LEFT JOIN projects project ON project.id = workflow.project_id
       WHERE workflow.created_by = $1
       ORDER BY workflow.updated_at DESC
       LIMIT 300`,
      [userId],
    );
    return { items: rows.map(assignableFor) };
  }
  if (kind === "event") {
    const rows = await withProjectAccess(
      userId,
      `SELECT event.id, event.title, event.project_id, project.name AS project_name
       FROM events event
       LEFT JOIN projects project ON project.id = event.project_id
       WHERE event.created_by = $1
       ORDER BY event.updated_at DESC
       LIMIT 300`,
      [userId],
    );
    return { items: rows.map(assignableFor) };
  }
  throw new ProjectsError("This item type cannot be assigned to a project.", 404);
};

const ASSIGNABLE_TABLES: Record<ProjectItemKind, string> = {
  event: "events",
  form: "forms",
  workflow: "workflows",
};

/**
 * Nothing is forced into a project. Passing a null projectId unassigns the
 * item, which returns it to the main module list rather than hiding it.
 */
export const assignItemToProject = async (
  userId: string,
  kind: string,
  itemId: string,
  projectId: string | null,
) => {
  if (!(kind in ASSIGNABLE_TABLES)) {
    throw new ProjectsError("This item type cannot be assigned to a project.", 404);
  }
  if (!isUuid(itemId)) {
    throw new ProjectsError("This item was not found.", 404, "item_not_found");
  }
  if (projectId !== null) {
    const scope = await projectScopeFor(userId);
    assertScopeAllows(scope, projectId);
    const owned = await withProjectAccess(
      userId,
      `SELECT id FROM projects WHERE id = $1 AND created_by = $2 LIMIT 1`,
      [projectId, userId],
    );
    if (!owned[0]) {
      throw new ProjectsError("This project was not found.", 404, "project_not_found");
    }
  }

  const table = ASSIGNABLE_TABLES[kind as ProjectItemKind];
  const rows = await database().query(
    `UPDATE ${table}
     SET project_id = $1, updated_at = NOW()
     WHERE id = $2 AND created_by = $3
     RETURNING id, project_id`,
    [projectId, itemId, userId],
  );
  if (!rows[0]) {
    throw new ProjectsError("This item was not found.", 404, "item_not_found");
  }
  return {
    itemId: text((rows[0] as DatabaseRow).id, 36),
    kind,
    projectId: (rows[0] as DatabaseRow).project_id
      ? text((rows[0] as DatabaseRow).project_id, 36)
      : null,
  };
};

export const listProjectAccess = async (userId: string, projectId: string) => {
  const scope = await projectScopeFor(userId);
  assertScopeAllows(scope, projectId);
  const access = await accessByProject(userId, [projectId]);
  return { members: access.get(projectId) || [] };
};

/**
 * Inviting someone directly into a project, so an agency onboarding a
 * contractor for one client never has to leave the project to do it. The scope
 * array is what the visibility check reads later.
 */
export const inviteToProject = async (
  userId: string,
  projectId: string,
  email: string,
  role: string,
) => {
  const scope = await projectScopeFor(userId);
  assertScopeAllows(scope, projectId);
  const cleanEmail = text(email, 255).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new ProjectsError("Enter a valid email address.");
  }
  const cleanRole = ["admin", "moderator", "user"].includes(text(role, 40))
    ? text(role, 40)
    : "user";

  const sql = database();
  const owned = await withProjectAccess(
    userId,
    `SELECT id FROM projects WHERE id = $1 AND created_by = $2 LIMIT 1`,
    [projectId, userId],
  );
  if (!owned[0]) {
    throw new ProjectsError("This project was not found.", 404, "project_not_found");
  }

  // An existing invitation gains this project rather than being duplicated,
  // so one contractor working across two clients stays one person.
  const existing = await sql.query(
    `SELECT id, project_scope FROM invitations
     WHERE invited_by = $1
       AND LOWER(email) = $2
       AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, cleanEmail],
  );
  if (existing[0]) {
    const current = (existing[0] as DatabaseRow).project_scope;
    const merged = Array.from(
      new Set([
        ...(Array.isArray(current) ? current.map((value) => String(value)) : []),
        projectId,
      ]),
    );
    await sql.query(
      `UPDATE invitations SET project_scope = $1::uuid[], role = $2 WHERE id = $3`,
      [merged, cleanRole, text((existing[0] as DatabaseRow).id, 36)],
    );
  } else {
    await sql.query(
      `INSERT INTO invitations (email, invited_by, role, status, project_scope)
       VALUES ($1, $2, $3, 'pending', $4::uuid[])`,
      [cleanEmail, userId, cleanRole, [projectId]],
    );
  }

  // If the invitee already has an account, membership is recorded now so the
  // scope is enforceable the moment they sign in rather than waiting on an
  // acceptance step that does not exist yet.
  await syncMembershipFromInvitations(userId, cleanEmail);
  return listProjectAccess(userId, projectId);
};

/**
 * Turns invitations into membership rows, which is what projectScopeFor()
 * reads. Kept idempotent so it is safe to call on every invite and revoke.
 */
export const syncMembershipFromInvitations = async (
  ownerId: string,
  email: string,
) => {
  const sql = database();
  await sql.transaction((transaction) => [
    transaction`SELECT set_config('app.current_user_id', ${ownerId}, true)`,
    transaction`
      INSERT INTO workspace_members (
        owner_id, user_id, role, status, project_scope, invitation_id
      )
      SELECT invitation.invited_by,
             invited.id,
             invitation.role,
             'active',
             invitation.project_scope,
             invitation.id
      FROM invitations invitation
      JOIN users invited ON LOWER(invited.email) = LOWER(invitation.email)
      WHERE invitation.invited_by = ${ownerId}
        AND LOWER(invitation.email) = ${email}
        AND invited.id <> ${ownerId}
      ON CONFLICT (owner_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        project_scope = EXCLUDED.project_scope,
        invitation_id = EXCLUDED.invitation_id,
        updated_at = NOW()
    `,
  ]);
};

/** Drops membership once an invitation no longer grants any project. */
const removeMembershipFor = async (ownerId: string, email: string) => {
  const sql = database();
  await sql.transaction((transaction) => [
    transaction`SELECT set_config('app.current_user_id', ${ownerId}, true)`,
    transaction`
      DELETE FROM workspace_members member
      USING users invited
      WHERE member.owner_id = ${ownerId}
        AND member.user_id = invited.id
        AND LOWER(invited.email) = ${email}
        AND member.role <> 'owner'
    `,
  ]);
};

/** Removes one project from an invitation's scope, not the invitation itself. */
export const revokeProjectAccess = async (
  userId: string,
  projectId: string,
  invitationId: string,
) => {
  const scope = await projectScopeFor(userId);
  assertScopeAllows(scope, projectId);
  if (!isUuid(invitationId)) {
    throw new ProjectsError("This invitation was not found.", 404);
  }
  const sql = database();
  const rows = await sql.query(
    `SELECT id, email, project_scope FROM invitations
     WHERE id = $1 AND invited_by = $2
     LIMIT 1`,
    [invitationId, userId],
  );
  if (!rows[0]) {
    throw new ProjectsError("This invitation was not found.", 404);
  }
  const invitationEmail = text((rows[0] as DatabaseRow).email, 255).toLowerCase();
  const current = (rows[0] as DatabaseRow).project_scope;
  const remaining = (Array.isArray(current) ? current.map(String) : []).filter(
    (value) => value !== projectId,
  );
  if (remaining.length === 0) {
    await sql.query(`DELETE FROM invitations WHERE id = $1 AND invited_by = $2`, [
      invitationId,
      userId,
    ]);
    // No projects left on the invitation means no reason to keep membership.
    await removeMembershipFor(userId, invitationEmail);
  } else {
    await sql.query(
      `UPDATE invitations SET project_scope = $1::uuid[] WHERE id = $2 AND invited_by = $3`,
      [remaining, invitationId, userId],
    );
    await syncMembershipFromInvitations(userId, invitationEmail);
  }
  return listProjectAccess(userId, projectId);
};

/**
 * The Projects rail entry stays hidden until a workspace has a second project
 * or has scoped an invitation to one. Until then every item lives in an
 * implicit default bucket and the tab would only add noise to a solo
 * dashboard.
 */
export const getProjectsVisibility = async (userId: string) => {
  const sql = database();
  const [projectRows, scopedRows] = await Promise.all([
    withProjectAccess(
      userId,
      `SELECT COUNT(*)::int AS value FROM projects WHERE created_by = $1`,
      [userId],
    ),
    sql.query(
      `SELECT COUNT(*)::int AS value FROM invitations
       WHERE invited_by = $1
         AND project_scope IS NOT NULL
         AND array_length(project_scope, 1) > 0`,
      [userId],
    ),
  ]);
  const projectCount = count((projectRows[0] as DatabaseRow | undefined)?.value);
  const scopedInvitations = count(
    (scopedRows[0] as DatabaseRow | undefined)?.value,
  );
  const scope = await projectScopeFor(userId);
  return {
    projectCount,
    reason:
      scope !== null
        ? "scoped_member"
        : scopedInvitations > 0
          ? "scoped_invitation"
          : projectCount >= 2
            ? "multiple_projects"
            : "hidden",
    scopedInvitations,
    // A scoped member only ever sees their projects, so the rail is the only
    // way in for them and is always shown.
    visible: scope !== null || projectCount >= 2 || scopedInvitations > 0,
  };
};

export async function handleProjectsData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const signedInUserId = await authenticatedUserId(request);
    // Everything below runs with the acting account on record, so scope checks
    // and the RLS policies see the person while the queries see the workspace.
    await projectActor.run(signedInUserId, () =>
      routeProjectsRequest(request, response, signedInUserId),
    );
  } catch (error) {
    if (error instanceof ProjectsError) {
      json(response, error.status, { code: error.code, error: error.message });
      return;
    }
    const databaseCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    console.error("[projects-data] unexpected request failure", {
      code: databaseCode || "unknown",
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      code: "projects_unavailable",
      error: "Projects could not be loaded. Please try again.",
    });
  }
}

async function routeProjectsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  signedInUserId: string,
) {
  {
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "list";
    const userId = await workspaceScopeFor(signedInUserId);

    if (request.method === "GET") {
      if (action === "list") {
        json(response, 200, await listProjects(userId));
        return;
      }
      if (action === "visibility") {
        json(response, 200, await getProjectsVisibility(userId));
        return;
      }
      if (action === "detail") {
        json(
          response,
          200,
          await getProject(userId, projectIdFrom(url.searchParams.get("projectId"))),
        );
        return;
      }
      if (action === "overview") {
        json(response, 200, {
          overview: await getProjectOverview(
            userId,
            projectIdFrom(url.searchParams.get("projectId")),
          ),
        });
        return;
      }
      if (action === "items") {
        json(
          response,
          200,
          await listProjectItems(
            userId,
            projectIdFrom(url.searchParams.get("projectId")),
            text(url.searchParams.get("kind"), 20),
          ),
        );
        return;
      }
      if (action === "assignable") {
        json(
          response,
          200,
          await listAssignableItems(userId, text(url.searchParams.get("kind"), 20)),
        );
        return;
      }
      if (action === "access") {
        json(
          response,
          200,
          await listProjectAccess(
            userId,
            projectIdFrom(url.searchParams.get("projectId")),
          ),
        );
        return;
      }
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      if (action === "create") {
        json(response, 200, await createProject(userId, body));
        return;
      }
      if (action === "update") {
        json(response, 200, await updateProject(userId, body));
        return;
      }
      if (action === "archive") {
        json(
          response,
          200,
          await setProjectStatus(userId, projectIdFrom(body.id), "archived"),
        );
        return;
      }
      if (action === "restore") {
        json(
          response,
          200,
          await setProjectStatus(userId, projectIdFrom(body.id), "active"),
        );
        return;
      }
      if (action === "delete") {
        json(
          response,
          200,
          await deleteProject(
            userId,
            projectIdFrom(body.id),
            text(body.confirmName, 120),
          ),
        );
        return;
      }
      if (action === "delete-many") {
        const projects = Array.isArray(body.projects)
          ? body.projects
              .filter(
                (entry): entry is RecordValue =>
                  Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
              )
              .map((entry) => ({
                id: text(entry.id, 36),
                name: text(entry.name, 120),
              }))
          : [];
        json(response, 200, await deleteProjects(userId, projects));
        return;
      }
      if (action === "status-many") {
        const ids = Array.isArray(body.ids)
          ? body.ids.filter((value): value is string => typeof value === "string")
          : [];
        const status = body.status === "archived" ? "archived" : "active";
        json(response, 200, await setProjectsStatus(userId, ids, status));
        return;
      }
      if (action === "assign") {
        const projectId = body.projectId == null ? null : projectIdFrom(body.projectId);
        json(
          response,
          200,
          await assignItemToProject(
            userId,
            text(body.kind, 20),
            text(body.itemId, 36),
            projectId,
          ),
        );
        return;
      }
      if (action === "invite") {
        json(
          response,
          200,
          await inviteToProject(
            userId,
            projectIdFrom(body.projectId),
            text(body.email, 255),
            text(body.role, 40),
          ),
        );
        return;
      }
      if (action === "revoke-access") {
        json(
          response,
          200,
          await revokeProjectAccess(
            userId,
            projectIdFrom(body.projectId),
            text(body.invitationId, 36),
          ),
        );
        return;
      }
    }

    json(response, 404, {
      code: "project_action_not_found",
      error: "This project action is not available.",
    });
  }
}

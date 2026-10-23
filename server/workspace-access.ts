/**
 * Who the caller is, and whose workspace they are acting in.
 *
 * Every module in this product scopes its rows by the workspace owner's user
 * id (`created_by = $userId`). That works while the only person in a workspace
 * is the person who created it. A member added by an owner has their own user
 * id, so without this resolver their dashboard would open onto an empty
 * workspace of their own rather than the one they were added to.
 *
 * `workspaceScopeFor()` maps a signed-in user id to the workspace id its data
 * queries should use. For an owner the two are the same value, which is why
 * adopting it in a module changes nothing for existing accounts.
 */
import { neon } from "@neondatabase/serverless";

import {
  ALWAYS_GRANTED_MODULES,
  isWorkspaceModuleKey,
  type WorkspaceModuleKey,
} from "../src/lib/workspace-modules";

export type WorkspaceMemberRole = "owner" | "admin" | "moderator" | "user";

export type WorkspaceContext = {
  /** The signed-in account. Personal settings and passwords belong to this id. */
  userId: string;
  /** The workspace whose rows the caller reads and writes. */
  workspaceId: string;
  role: WorkspaceMemberRole;
  /** `null` means unrestricted. */
  allowedModules: WorkspaceModuleKey[] | null;
  isOwner: boolean;
  /** True while a system-generated password is still in place. */
  mustChangePassword: boolean;
  /** Membership exists but is paused: the workspace opens to nothing. */
  suspended: boolean;
  /** The account itself is barred from signing in anywhere. */
  blocked: boolean;
};

const contextCacheTtlMs = 15_000;
const contextCache = new Map<
  string,
  { expiresAt: number; value: WorkspaceContext }
>();

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return neon(url);
};

const isRole = (value: unknown): value is WorkspaceMemberRole =>
  value === "owner" || value === "admin" || value === "moderator" || value === "user";

const readModules = (value: unknown): WorkspaceModuleKey[] | null => {
  if (!Array.isArray(value)) return null;
  const granted = new Set<WorkspaceModuleKey>(ALWAYS_GRANTED_MODULES);
  for (const entry of value) {
    if (isWorkspaceModuleKey(entry)) granted.add(entry);
  }
  return [...granted];
};

/** Drops a cached context so a role or module change takes effect immediately. */
export const invalidateWorkspaceContext = (userId?: string) => {
  if (userId) {
    contextCache.delete(userId);
    return;
  }
  contextCache.clear();
};

/**
 * Resolves the caller's workspace. Cached briefly because it runs on every
 * authenticated request across every module; membership changes clear the entry
 * through invalidateWorkspaceContext() so the window is only for changes made
 * outside this process.
 */
export const workspaceContextFor = async (
  userId: string,
): Promise<WorkspaceContext> => {
  const cached = contextCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const ownWorkspace: WorkspaceContext = {
    userId,
    workspaceId: userId,
    role: "owner",
    allowedModules: null,
    isOwner: true,
    mustChangePassword: false,
    suspended: false,
    blocked: false,
  };

  let value = ownWorkspace;
  try {
    const sql = database();
    // An active membership wins. A suspended one is still returned, because
    // showing "your access is suspended" in the workspace they belong to is
    // far clearer than silently dropping them into an empty workspace of
    // their own, which is what ignoring the row would do.
    const rows = await sql.query(
      `SELECT member.owner_id, member.role, member.allowed_modules,
              member.status,
              user_account.must_change_password, user_account.blocked_at
       FROM users user_account
       LEFT JOIN workspace_members member
         ON member.user_id = user_account.id
       WHERE user_account.id = $1
       ORDER BY CASE WHEN member.status = 'active' THEN 0 ELSE 1 END,
                CASE WHEN member.role = 'owner' THEN 0 ELSE 1 END,
                member.created_at
       LIMIT 1`,
      [userId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (row) {
      const ownerId = String(row.owner_id || "") || userId;
      const role = isRole(row.role) ? row.role : "owner";
      const isOwner = ownerId === userId || role === "owner";
      const suspended = row.status === "suspended";
      value = {
        userId,
        workspaceId: ownerId,
        role,
        // Owners and admins are unrestricted whatever the column says. A
        // suspended member is restricted to nothing at all.
        allowedModules: suspended
          ? []
          : isOwner || role === "admin"
            ? null
            : readModules(row.allowed_modules),
        isOwner: isOwner && !suspended,
        mustChangePassword: row.must_change_password === true,
        suspended,
        blocked: Boolean(row.blocked_at),
      };
    }
  } catch {
    // A workspace that predates the membership table, or a database blip, must
    // not lock an owner out of their own data. Their own workspace is the
    // correct answer in both cases.
    value = ownWorkspace;
  }

  contextCache.set(userId, {
    expiresAt: Date.now() + contextCacheTtlMs,
    value,
  });
  return value;
};

/**
 * The workspace id a data query should scope to. Drop-in for call sites that
 * previously used the signed-in user id directly.
 */
export const workspaceScopeFor = async (userId: string) =>
  (await workspaceContextFor(userId)).workspaceId;

/** True when the caller may administer the workspace itself. */
export const canManageWorkspace = (context: WorkspaceContext) =>
  !context.suspended &&
  !context.blocked &&
  (context.isOwner || context.role === "admin");

export const canOpenModule = async (userId: string, moduleKey: string) => {
  const context = await workspaceContextFor(userId);
  if (!context.allowedModules) return true;
  if (ALWAYS_GRANTED_MODULES.includes(moduleKey as WorkspaceModuleKey)) return true;
  return context.allowedModules.includes(moduleKey as WorkspaceModuleKey);
};

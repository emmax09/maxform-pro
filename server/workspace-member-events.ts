/**
 * The membership audit trail: recording it, and reading it back.
 *
 * Kept apart from workspace-members.ts because auth.ts also writes to it (a
 * member signing in is the event an administrator most often wants to see), and
 * importing the whole membership module into the sign-in path to get one
 * function would be a poor trade.
 *
 * Recording is always best-effort. An audit write that fails must never take
 * down the action it was describing -- a member who cannot be added because
 * their audit row would not insert is a worse outcome than a gap in the trail.
 */
import { neon } from "@neondatabase/serverless";

type RecordValue = Record<string, unknown>;

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return neon(url);
};

const text = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

/** Every action the trail can hold, and how each one reads in the timeline. */
export const MEMBER_EVENT_LABELS: Record<string, string> = {
  member_added: "Added to the workspace",
  member_signed_in: "Signed in",
  member_role_changed: "Role changed",
  member_access_changed: "Tab access changed",
  member_details_changed: "Details changed",
  member_suspended: "Workspace access suspended",
  member_restored: "Workspace access restored",
  member_blocked: "Blocked from signing in",
  member_unblocked: "Unblocked",
  member_password_set: "Password set by an administrator",
  member_password_generated: "New password generated and sent",
  member_password_self_changed: "Changed their own password",
  member_removed: "Removed from the workspace",
  member_account_deleted: "Account deleted",
};

export type MemberEventInput = {
  workspaceId: string;
  memberUserId?: string | null;
  memberLabel?: string;
  actorUserId?: string | null;
  actorLabel?: string;
  action: keyof typeof MEMBER_EVENT_LABELS | string;
  detail?: RecordValue;
};

/**
 * Writes one row. Never throws and never rejects -- callers deliberately do not
 * await a result they are not allowed to act on.
 */
export const recordMemberEvent = async (input: MemberEventInput) => {
  try {
    const sql = database();
    await sql.query(
      `INSERT INTO workspace_member_events (
         workspace_id, member_user_id, member_label, actor_user_id, actor_label,
         action, detail
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.workspaceId,
        input.memberUserId || null,
        text(input.memberLabel, 320),
        input.actorUserId || null,
        text(input.actorLabel, 320),
        text(input.action, 60),
        JSON.stringify(input.detail || {}),
      ],
    );
  } catch {
    // A missing trail is recoverable; a failed member operation is not.
  }
};

const eventRow = (row: RecordValue) => ({
  id: text(row.id, 36),
  action: text(row.action, 60),
  label: MEMBER_EVENT_LABELS[text(row.action, 60)] || text(row.action, 60),
  memberLabel: text(row.member_label, 320),
  actorLabel: text(row.actor_label, 320),
  /** True when the member did it themselves rather than having it done to them. */
  bySelf: !row.actor_user_id || row.actor_user_id === row.member_user_id,
  detail: (row.detail || {}) as RecordValue,
  createdAt: row.created_at ? String(row.created_at) : "",
});

export type MemberEvent = ReturnType<typeof eventRow>;

/**
 * One member's history, newest first. Scoped by workspace as well as member so
 * an id from another workspace returns nothing rather than someone else's
 * record.
 */
export const listMemberActivity = async (
  workspaceId: string,
  memberUserId: string,
  limit = 100,
) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT id, action, member_label, member_user_id, actor_user_id,
            actor_label, detail, created_at
     FROM workspace_member_events
     WHERE workspace_id = $1 AND member_user_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [workspaceId, memberUserId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map((row) => eventRow(row as RecordValue));
};

/** The whole workspace's membership history, for the activity overview. */
export const listWorkspaceMemberActivity = async (
  workspaceId: string,
  limit = 100,
) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT id, action, member_label, member_user_id, actor_user_id,
            actor_label, detail, created_at
     FROM workspace_member_events
     WHERE workspace_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [workspaceId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map((row) => eventRow(row as RecordValue));
};

/**
 * Last-seen time per member, for the members table. One grouped query rather
 * than one per row.
 */
export const lastActiveByMember = async (workspaceId: string) => {
  try {
    const sql = database();
    const rows = await sql.query(
      `SELECT member_user_id, MAX(created_at) AS last_active
       FROM workspace_member_events
       WHERE workspace_id = $1
         AND action = 'member_signed_in'
         AND member_user_id IS NOT NULL
       GROUP BY member_user_id`,
      [workspaceId],
    );
    return new Map(
      rows.map((row) => [
        text((row as RecordValue).member_user_id, 36),
        String((row as RecordValue).last_active || ""),
      ]),
    );
  } catch {
    // The table may predate this workspace's migration; an empty map simply
    // shows every member as not yet seen.
    return new Map<string, string>();
  }
};

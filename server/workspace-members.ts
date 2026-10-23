/**
 * Workspace membership: provisioning, module grants, and the credentials mail.
 *
 * Adding a member here creates a real, signable-in account rather than a
 * pending invitation nobody can act on. The member is attached to the adding
 * owner's workspace through `workspace_members`, which is what
 * server/workspace-access.ts reads to point every module's queries at the right
 * workspace.
 *
 * Two rules worth stating because they are security-relevant:
 *
 *   * An address that already has a MaxForm account is never re-provisioned.
 *     It is added to the workspace and told to use the password it already has.
 *     Otherwise "add member" would be a password reset for any account whose
 *     address someone could type.
 *   * The generated password is returned to the caller exactly once, in the
 *     response to the request that created it, and is stored only as a bcrypt
 *     hash. Re-sending it is a fresh generation, not a lookup.
 */
import { randomInt, randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { hash } from "bcrypt-ts";

import {
  ALWAYS_GRANTED_MODULES,
  normalizeModuleAccess,
  WORKSPACE_MODULE_LABELS,
  type WorkspaceModuleKey,
} from "../src/lib/workspace-modules";
import { configuredAppUrl } from "./app-url";
import {
  invalidateWorkspaceContext,
  type WorkspaceContext,
} from "./workspace-access";
import {
  lastActiveByMember,
  listMemberActivity,
  recordMemberEvent,
} from "./workspace-member-events";

type RecordValue = Record<string, unknown>;

export class MembersError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "members_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new MembersError(
      "Workspace members are temporarily unavailable.",
      503,
      "members_unavailable",
    );
  }
  return neon(url);
};

const text = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const memberEmail = (value: unknown) => {
  const email = text(value, 254).toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MembersError("Enter a valid email address.");
  }
  return email;
};

const memberRole = (value: unknown) => {
  const role = text(value, 20).toLowerCase();
  if (role === "admin" || role === "moderator" || role === "user") return role;
  return "user";
};

/**
 * Admins run the workspace, so restricting their tabs would be a promise the
 * product does not keep. Everyone else gets exactly what was ticked.
 */
const grantsFor = (role: string, modules: unknown) =>
  role === "admin" ? null : normalizeModuleAccess(modules);

// Excludes characters that are misread when a password is copied off a screen:
// no O/0, l/1/I, or symbols that get mangled by mail clients.
const passwordCharset = {
  lower: "abcdefghjkmnpqrstuvwxyz",
  upper: "ABCDEFGHJKMNPQRSTUVWXYZ",
  digits: "23456789",
  symbols: "!@#$%*?-",
};

const pick = (source: string) => source[randomInt(0, source.length)];

/** 16 characters with at least one of each class, shuffled with a CSPRNG. */
export const generateMemberPassword = () => {
  const all =
    passwordCharset.lower +
    passwordCharset.upper +
    passwordCharset.digits +
    passwordCharset.symbols;
  const characters = [
    pick(passwordCharset.lower),
    pick(passwordCharset.upper),
    pick(passwordCharset.digits),
    pick(passwordCharset.symbols),
  ];
  while (characters.length < 16) characters.push(pick(all));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(0, index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join("");
};

/**
 * A username the owner typed. Deliberately narrow: lowercase letters, digits
 * and `. _ -` only, so a handle can never be confused with an email address at
 * the sign-in prompt, and never collides with the generated form.
 */
export const normalizeChosenUsername = (value: unknown) => {
  // Read at full length rather than through text(): silently truncating an
  // over-long handle would hand the member a username they never agreed to.
  const username = String(value ?? "").trim().toLowerCase();
  if (!username) return "";
  if (username.includes("@")) {
    throw new MembersError(
      "A username cannot contain @. Use letters, numbers, dots, dashes or underscores.",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,59}$/.test(username)) {
    throw new MembersError(
      "A username must be 3-60 characters using letters, numbers, dots, dashes or underscores, and start with a letter or number.",
    );
  }
  return username;
};

/**
 * A password the owner typed. The floor matches the one the reset flow
 * enforces, plus a mix requirement -- an owner choosing on someone else's
 * behalf does not get to pick "password1" for them.
 */
export const validateChosenPassword = (value: unknown) => {
  const password = String(value ?? "");
  if (!password) return "";
  if (password.length < 10 || password.length > 128) {
    throw new MembersError(
      "A password you set must be between 10 and 128 characters.",
    );
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  if (classes < 3) {
    throw new MembersError(
      "Use at least three of: lowercase, uppercase, numbers, symbols.",
    );
  }
  return password;
};

/** Refuses a handle already in use, ignoring one account that may keep its own. */
const assertUsernameFree = async (username: string, exceptUserId = "") => {
  const sql = database();
  const taken = await sql.query(
    `SELECT 1 FROM users
     WHERE lower(username) = lower($1) AND ($2 = '' OR id <> $2::uuid)
     LIMIT 1`,
    [username, exceptUserId],
  );
  if (taken.length > 0) {
    throw new MembersError("That username is already taken.", 409);
  }
};

/** Refuses an address already in use, ignoring one account that may keep its own. */
const assertEmailFree = async (email: string, exceptUserId = "") => {
  const sql = database();
  const taken = await sql.query(
    `SELECT 1 FROM users
     WHERE lower(email) = lower($1) AND ($2 = '' OR id <> $2::uuid)
     LIMIT 1`,
    [email, exceptUserId],
  );
  if (taken.length > 0) {
    throw new MembersError(
      "That email address already belongs to another account.",
      409,
    );
  }
};

const usernameBase = (fullName: string, email: string) => {
  const fromName = fullName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  const fromEmail = email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "");
  const base = (fromName || fromEmail || "member").slice(0, 24);
  return base.length >= 3 ? base : `${base}member`.slice(0, 24);
};

/**
 * A handle nobody else holds. The plain form is tried first so the common case
 * reads well, then a numeric suffix, then a random one — the loop cannot run
 * forever and cannot return a duplicate.
 */
export const reserveUsername = async (fullName: string, email: string) => {
  const sql = database();
  const base = usernameBase(fullName, email);
  const candidates = [base];
  for (let index = 2; index <= 20; index += 1) candidates.push(`${base}${index}`);
  candidates.push(`${base}.${randomUUID().replace(/-/g, "").slice(0, 6)}`);

  for (const candidate of candidates) {
    const taken = await sql.query(
      `SELECT 1 FROM users WHERE lower(username) = lower($1) LIMIT 1`,
      [candidate],
    );
    if (taken.length === 0) return candidate;
  }
  throw new MembersError(
    "A username could not be reserved for this member. Try a different name.",
    409,
  );
};

const signInUrl = () => `${configuredAppUrl()}/auth`;

/**
 * The variables every member template reads.
 *
 * `workspace.name` is filled in by the mailer from company settings, so only
 * the sign-in link is supplied here. `passwordLabel` distinguishes a generated
 * password the member is asked to replace from one their owner chose for them.
 */
const memberTemplateVariables = (input: {
  fullName: string;
  username?: string;
  email?: string;
  role?: string;
  modules?: WorkspaceModuleKey[] | null;
  password?: string;
  temporary?: boolean;
}): RecordValue => ({
  workspace: { signInUrl: signInUrl() },
  member: {
    name: input.fullName,
    username: input.username || "",
    email: input.email || "",
    role: input.role ? memberRoleLabel(input.role) : "",
    tabs: moduleSummary(input.modules ?? null),
    password: input.password || "",
    passwordLabel:
      input.temporary === false ? "Password" : "Temporary password",
  },
});

/** The role as a member reads it, not as the column stores it. */
const memberRoleLabel = (role: string) =>
  role === "admin"
    ? "Admin"
    : role === "moderator"
      ? "Manager"
      : role === "owner"
        ? "Owner"
        : "Member";

const moduleSummary = (modules: WorkspaceModuleKey[] | null) => {
  if (!modules) return ["Every module in the workspace"];
  const granted = modules.filter(
    (key) => !ALWAYS_GRANTED_MODULES.includes(key),
  );
  if (granted.length === 0) return ["Home and your own account settings"];
  return granted.map((key) => WORKSPACE_MODULE_LABELS[key] || key);
};

/**
 * Delivery is attempted inline so the response can say honestly whether the
 * message left the building. A failure here never rolls the member back: the
 * account exists and the owner is shown the credentials to pass on by hand.
 */
/** The member-facing templates, as seeded into the Email module. */
export type MemberTemplateKey =
  | "member_credentials"
  | "member_password_reset"
  | "member_workspace_access"
  | "member_access_changed"
  | "member_suspended"
  | "member_removed";

const deliverMemberEmail = async (input: {
  ownerId: string;
  to: string;
  templateKey: MemberTemplateKey;
  variables: RecordValue;
}) => {
  try {
    const { sendEmailNow } = await import("./email-service");
    await sendEmailNow({
      userId: input.ownerId,
      to: input.to,
      // Sent through the workspace's own template rather than inline HTML, so
      // these appear in Email settings alongside every other message the
      // product sends and can be reworded there. The password is a variable
      // resolved at send time -- it is never written into the template.
      templateKey: input.templateKey,
      variables: input.variables,
      idempotencyKey: `member-${input.templateKey}-${input.to}-${Date.now()}`,
    });
    return { delivered: true, error: "" };
  } catch (error) {
    return {
      delivered: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "The email could not be sent.",
    };
  }
};

const memberRow = (row: RecordValue) => ({
  id: text(row.id, 36),
  userId: text(row.user_id, 36),
  email: text(row.email, 254),
  username: text(row.username, 60),
  fullName: text(row.full_name, 255) || text(row.email, 254),
  avatarUrl: text(row.avatar_url, 2_048) || null,
  jobTitle: text(row.job_title, 100) || "",
  role: text(row.role, 20) || "user",
  status: text(row.status, 20) || "active",
  allowedModules: Array.isArray(row.allowed_modules)
    ? (row.allowed_modules.map(String) as WorkspaceModuleKey[])
    : null,
  isOwner: text(row.role, 20) === "owner",
  pendingCredentials: row.must_change_password === true,
  blocked: Boolean(row.blocked_at),
  /** This workspace created the account, so it may also delete it outright. */
  provisioned: row.provisioned === true,
  credentialsSentAt: row.credentials_sent_at
    ? String(row.credentials_sent_at)
    : "",
  createdAt: row.created_at ? String(row.created_at) : "",
});

export type WorkspaceMember = ReturnType<typeof memberRow>;

export const listWorkspaceMembers = async (context: WorkspaceContext) => {
  const sql = database();
  const [rows, lastActive] = await Promise.all([
    sql.query(
      `SELECT member.id, member.user_id, member.role, member.status,
              member.allowed_modules, member.created_at, member.provisioned,
              member.credentials_sent_at,
              user_account.email, user_account.username, user_account.full_name,
              user_account.must_change_password, user_account.blocked_at,
              profile.avatar_url, profile.job_title
       FROM workspace_members member
       JOIN users user_account ON user_account.id = member.user_id
       LEFT JOIN profiles profile ON profile.user_id = member.user_id
       WHERE member.owner_id = $1
       ORDER BY CASE WHEN member.role = 'owner' THEN 0 ELSE 1 END,
                member.created_at`,
      [context.workspaceId],
    ),
    lastActiveByMember(context.workspaceId),
  ]);
  return rows.map((row) => {
    const member = memberRow(row as RecordValue);
    return {
      ...member,
      lastActiveAt: lastActive.get(member.userId) || "",
    };
  });
};

/** One member's audit trail. Owner and admins only; enforced by the caller. */
export const getMemberActivity = async (
  context: WorkspaceContext,
  memberId: string,
) => {
  assertCanManage(context);
  const member = await targetMemberRow(context, memberId);
  return {
    member: {
      id: text(member.id, 36),
      fullName: text(member.full_name, 255),
      email: text(member.email, 254),
    },
    events: await listMemberActivity(
      context.workspaceId,
      text(member.user_id, 36),
    ),
  };
};

const assertCanManage = (context: WorkspaceContext) => {
  if (!context.isOwner && context.role !== "admin") {
    throw new MembersError(
      "Only the workspace owner or an admin can manage members.",
      403,
      "members_forbidden",
    );
  }
};

/**
 * Looks up a member of this workspace without the mutation guards. Reading a
 * history is not changing anything, so the owner's own row and the caller's own
 * row are both fair game here.
 */
const targetMemberRow = async (context: WorkspaceContext, memberId: string) => {
  if (!isUuid(memberId)) {
    throw new MembersError("This member could not be found.", 404);
  }
  const sql = database();
  const rows = await sql.query(
    `SELECT member.id, member.user_id, member.role,
            user_account.email, user_account.full_name
     FROM workspace_members member
     JOIN users user_account ON user_account.id = member.user_id
     WHERE member.id = $1 AND member.owner_id = $2
     LIMIT 1`,
    [memberId, context.workspaceId],
  );
  const row = rows[0] as RecordValue | undefined;
  if (!row) throw new MembersError("This member could not be found.", 404);
  return row;
};

/** Blocks an admin from editing the owner, or anyone from editing themselves out. */
const targetMember = async (context: WorkspaceContext, memberId: string) => {
  if (!isUuid(memberId)) {
    throw new MembersError("This member could not be found.", 404);
  }
  const sql = database();
  const rows = await sql.query(
    `SELECT member.id, member.user_id, member.role, member.status,
            member.allowed_modules, member.provisioned,
            user_account.email, user_account.full_name, user_account.blocked_at
     FROM workspace_members member
     JOIN users user_account ON user_account.id = member.user_id
     WHERE member.id = $1 AND member.owner_id = $2
     LIMIT 1`,
    [memberId, context.workspaceId],
  );
  const row = rows[0] as RecordValue | undefined;
  if (!row) throw new MembersError("This member could not be found.", 404);
  if (text(row.role, 20) === "owner") {
    throw new MembersError("The workspace owner cannot be changed.", 400);
  }
  if (text(row.user_id, 36) === context.userId) {
    throw new MembersError("You cannot change your own access.", 400);
  }
  return row;
};

export const addWorkspaceMember = async (
  context: WorkspaceContext,
  body: RecordValue,
) => {
  assertCanManage(context);
  const email = memberEmail(body.email);
  const fullName = text(body.fullName, 255) || email.split("@")[0];
  if (fullName.length < 2) throw new MembersError("Enter the member's name.");
  const role = memberRole(body.role);
  const modules = grantsFor(role, body.modules);
  const jobTitle = text(body.jobTitle, 100) || null;
  // Both optional. Empty means "generate one", which is what the dialog sends
  // unless the owner switched to setting them by hand.
  const chosenUsername = normalizeChosenUsername(body.username);
  const chosenPassword = validateChosenPassword(body.password);

  const sql = database();
  const ownerRows = await sql.query(
    `SELECT email FROM users WHERE id = $1 LIMIT 1`,
    [context.workspaceId],
  );
  if (text((ownerRows[0] as RecordValue | undefined)?.email, 254).toLowerCase() === email) {
    throw new MembersError("You are already the owner of this workspace.", 409);
  }

  const existingRows = await sql.query(
    `SELECT user_account.id, user_account.email, user_account.username,
            user_account.full_name,
            EXISTS (
              SELECT 1 FROM workspace_members other
              WHERE other.user_id = user_account.id AND other.status = 'active'
            ) AS has_workspace,
            EXISTS (
              SELECT 1 FROM workspace_members mine
              WHERE mine.user_id = user_account.id AND mine.owner_id = $2
            ) AS in_this_workspace
     FROM users user_account
     WHERE lower(user_account.email) = $1
     LIMIT 1`,
    [email, context.workspaceId],
  );
  const existing = existingRows[0] as RecordValue | undefined;

  // --- Already has an account: attach only, never touch their password. ------
  if (existing) {
    const userId = text(existing.id, 36);
    if (existing.in_this_workspace === true) {
      throw new MembersError(
        "That person is already a member of this workspace.",
        409,
      );
    }
    // A signed-in account works in exactly one workspace -- there is no
    // switcher to move between them -- so adding an address that already
    // belongs somewhere would record a membership that never takes effect.
    // Saying so beats a silent no-op.
    if (existing.has_workspace === true) {
      throw new MembersError(
        "That email already belongs to a MaxForm workspace, so it cannot be added to this one. Use an address that has not signed up yet.",
        409,
        "member_email_in_use",
      );
    }
    await sql.query(
      `INSERT INTO workspace_members (
         owner_id, user_id, role, status, allowed_modules
       )
       VALUES ($1, $2, $3, 'active', $4::text[])
       ON CONFLICT (owner_id, user_id)
       DO UPDATE SET role = EXCLUDED.role,
                     status = 'active',
                     allowed_modules = EXCLUDED.allowed_modules,
                     updated_at = NOW()`,
      [context.workspaceId, userId, role, modules],
    );
    invalidateWorkspaceContext(userId);
    await recordMemberEvent({
      workspaceId: context.workspaceId,
      memberUserId: userId,
      memberLabel: email,
      actorUserId: context.userId,
      action: "member_added",
      detail: { role, modules, reusedAccount: true },
    });
    const delivery = await deliverMemberEmail({
      ownerId: context.workspaceId,
      to: email,
      templateKey: "member_workspace_access",
      variables: memberTemplateVariables({
        fullName: text(existing.full_name, 255) || fullName,
        email,
        role,
        modules,
      }),
    });
    return {
      members: await listWorkspaceMembers(context),
      credentials: null,
      emailDelivered: delivery.delivered,
      emailError: delivery.error,
      reusedAccount: true,
    };
  }

  // --- New account: provision credentials and mail them. --------------------
  const password = chosenPassword || generateMemberPassword();
  const passwordHash = await hash(password, 12);
  let username: string;
  if (chosenUsername) {
    await assertUsernameFree(chosenUsername);
    username = chosenUsername;
  } else {
    username = await reserveUsername(fullName, email);
  }
  const userId = randomUUID();
  const shortId = randomUUID().replace(/-/g, "").slice(0, 5);

  await sql.query(
    `INSERT INTO users (
       id, email, username, password_hash, full_name, short_id,
       must_change_password, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
    [
      userId,
      email,
      username,
      passwordHash,
      fullName,
      shortId,
      // A password the owner chose and communicated is theirs to keep; only a
      // machine-generated one carries the "replace this" prompt.
      !chosenPassword,
    ],
  );
  await sql.query(
    `INSERT INTO profiles (user_id, full_name, job_title, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, fullName, jobTitle],
  );
  // Deliberately no self-owner row. Membership resolution prefers an owner
  // row, so giving a provisioned member one would land them in an empty
  // workspace of their own instead of the one they were just added to.
  await sql.query(
    `INSERT INTO workspace_members (
       owner_id, user_id, role, status, allowed_modules, provisioned,
       credentials_sent_at
     )
     VALUES ($1, $2, $3, 'active', $4::text[], TRUE, NOW())
     ON CONFLICT (owner_id, user_id)
     DO UPDATE SET role = EXCLUDED.role,
                   status = 'active',
                   allowed_modules = EXCLUDED.allowed_modules,
                   provisioned = TRUE,
                   credentials_sent_at = NOW(),
                   updated_at = NOW()`,
    [context.workspaceId, userId, role, modules],
  );
  invalidateWorkspaceContext(userId);
  await recordMemberEvent({
    workspaceId: context.workspaceId,
    memberUserId: userId,
    memberLabel: email,
    actorUserId: context.userId,
    action: "member_added",
    detail: {
      role,
      modules,
      username,
      // Never the password itself -- only whether it was chosen or generated.
      credentials: chosenPassword ? "set by owner" : "generated",
    },
  });

  const delivery = await deliverMemberEmail({
    ownerId: context.workspaceId,
    to: email,
    templateKey: "member_credentials",
    variables: memberTemplateVariables({
      fullName,
      username,
      email,
      role,
      modules,
      password,
      // A password the owner chose is the member's to keep, so it is not
      // presented as temporary.
      temporary: !chosenPassword,
    }),
  });

  return {
    members: await listWorkspaceMembers(context),
    // Shown once so the owner can pass the details on if mail is not configured.
    credentials: { username, email, password },
    emailDelivered: delivery.delivered,
    emailError: delivery.error,
    reusedAccount: false,
  };
};

export const updateWorkspaceMember = async (
  context: WorkspaceContext,
  body: RecordValue,
) => {
  assertCanManage(context);
  const member = await targetMember(context, text(body.memberId, 36));
  const role = Object.prototype.hasOwnProperty.call(body, "role")
    ? memberRole(body.role)
    : text(member.role, 20);
  const status = text(body.status, 20) === "suspended" ? "suspended" : "active";
  // Omitting `modules` leaves the grant alone. Treating it as an empty list
  // would make a request that only changes the role silently revoke every tab.
  const modules = grantsFor(
    role,
    Object.prototype.hasOwnProperty.call(body, "modules")
      ? body.modules
      : member.allowed_modules,
  );

  const sql = database();
  const userId = text(member.user_id, 36);

  // Identity edits are optional and independent of the access edits above, so
  // an owner correcting a typo in an address does not have to restate the
  // whole grant. Each is validated and uniqueness-checked before anything is
  // written.
  const nextFullName = Object.prototype.hasOwnProperty.call(body, "fullName")
    ? text(body.fullName, 255)
    : "";
  if (nextFullName && nextFullName.length < 2) {
    throw new MembersError("Enter the member's name.");
  }
  const nextEmail = Object.prototype.hasOwnProperty.call(body, "email")
    ? memberEmail(body.email)
    : "";
  const nextUsername = Object.prototype.hasOwnProperty.call(body, "username")
    ? normalizeChosenUsername(body.username)
    : "";
  if (nextEmail && nextEmail !== text(member.email, 254).toLowerCase()) {
    await assertEmailFree(nextEmail, userId);
  }
  if (nextUsername) await assertUsernameFree(nextUsername, userId);

  if (nextFullName || nextEmail || nextUsername) {
    await sql.query(
      `UPDATE users
       SET full_name = COALESCE(NULLIF($2, ''), full_name),
           email = COALESCE(NULLIF($3, ''), email),
           username = COALESCE(NULLIF($4, ''), username),
           updated_at = NOW()
       WHERE id = $1`,
      [userId, nextFullName, nextEmail, nextUsername],
    );
    if (nextFullName) {
      await sql.query(
        `UPDATE profiles SET full_name = $2, updated_at = NOW() WHERE user_id = $1`,
        [userId, nextFullName],
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "jobTitle")) {
    await sql.query(
      `UPDATE profiles SET job_title = $2, updated_at = NOW() WHERE user_id = $1`,
      [userId, text(body.jobTitle, 100) || null],
    );
  }

  await sql.query(
    `UPDATE workspace_members
     SET role = $1, status = $2, allowed_modules = $3::text[], updated_at = NOW()
     WHERE id = $4 AND owner_id = $5`,
    [role, status, modules, text(member.id, 36), context.workspaceId],
  );
  invalidateWorkspaceContext(userId);

  // One request can change several things. Each is recorded on its own so the
  // timeline reads as what happened rather than as one opaque "updated".
  const previousRole = text(member.role, 20);
  const memberLabel = nextEmail || text(member.email, 254);
  const audit = {
    workspaceId: context.workspaceId,
    memberUserId: userId,
    memberLabel,
    actorUserId: context.userId,
  };
  if (role !== previousRole) {
    await recordMemberEvent({
      ...audit,
      action: "member_role_changed",
      detail: { from: previousRole, to: role },
    });
  }
  if (status !== text(member.status, 20)) {
    await recordMemberEvent({
      ...audit,
      action: status === "suspended" ? "member_suspended" : "member_restored",
    });
  }
  if (Object.prototype.hasOwnProperty.call(body, "modules")) {
    await recordMemberEvent({
      ...audit,
      action: "member_access_changed",
      detail: { modules },
    });
  }
  // Told, not just recorded. A member whose access changed underneath them
  // otherwise discovers it by finding a tab missing. Suspension takes
  // precedence: saying "your tabs changed" to someone who has just been locked
  // out of all of them would be the wrong message.
  const memberName = nextFullName || text(member.full_name, 255) || memberLabel;
  if (status === "suspended" && status !== text(member.status, 20)) {
    await deliverMemberEmail({
      ownerId: context.workspaceId,
      to: memberLabel,
      templateKey: "member_suspended",
      variables: memberTemplateVariables({ fullName: memberName }),
    });
  } else if (
    role !== previousRole ||
    Object.prototype.hasOwnProperty.call(body, "modules")
  ) {
    await deliverMemberEmail({
      ownerId: context.workspaceId,
      to: memberLabel,
      templateKey: "member_access_changed",
      variables: memberTemplateVariables({
        fullName: memberName,
        role,
        modules,
      }),
    });
  }
  if (nextFullName || nextEmail || nextUsername) {
    await recordMemberEvent({
      ...audit,
      action: "member_details_changed",
      detail: {
        ...(nextFullName ? { fullName: nextFullName } : {}),
        ...(nextEmail ? { email: nextEmail } : {}),
        ...(nextUsername ? { username: nextUsername } : {}),
      },
    });
  }
  return { members: await listWorkspaceMembers(context) };
};

/**
 * The owner setting a password directly, rather than generating one. The member
 * keeps it -- there is no "replace this" prompt, because the owner and member
 * agreed on it between themselves.
 */
export const setMemberPassword = async (
  context: WorkspaceContext,
  body: RecordValue,
) => {
  assertCanManage(context);
  const member = await targetMember(context, text(body.memberId, 36));
  const userId = text(member.user_id, 36);
  const password = validateChosenPassword(body.password);
  if (!password) throw new MembersError("Enter a password to set.");
  const notify = body.notify !== false;

  const sql = database();
  const rows = await sql.query(
    `SELECT email, username, full_name FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const account = rows[0] as RecordValue | undefined;
  if (!account) throw new MembersError("This member could not be found.", 404);

  const passwordHash = await hash(password, 12);
  await sql.query(
    `UPDATE users
     SET password_hash = $1, must_change_password = FALSE, updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, userId],
  );
  // A password change invalidates any reset the member had in flight.
  await sql.query(
    `UPDATE password_reset_tokens SET used = TRUE
     WHERE user_id = $1 AND used = FALSE`,
    [userId],
  );
  invalidateWorkspaceContext(userId);

  const email = text(account.email, 254);
  const username = text(account.username, 60);
  await recordMemberEvent({
    workspaceId: context.workspaceId,
    memberUserId: userId,
    memberLabel: email,
    actorUserId: context.userId,
    action: "member_password_set",
    detail: { emailed: notify },
  });
  let delivery = { delivered: false, error: "" };
  if (notify) {
    const grants = await sql.query(
      `SELECT allowed_modules FROM workspace_members
       WHERE owner_id = $1 AND user_id = $2 LIMIT 1`,
      [context.workspaceId, userId],
    );
    const stored = (grants[0] as RecordValue | undefined)?.allowed_modules;
      delivery = await deliverMemberEmail({
      ownerId: context.workspaceId,
      to: email,
      templateKey: "member_credentials",
      variables: memberTemplateVariables({
        fullName: text(account.full_name, 255) || email,
        username,
        email,
        modules: Array.isArray(stored)
          ? (stored.map(String) as WorkspaceModuleKey[])
          : null,
        password,
        temporary: false,
      }),
    });
    await sql.query(
      `UPDATE workspace_members SET credentials_sent_at = NOW()
       WHERE owner_id = $1 AND user_id = $2`,
      [context.workspaceId, userId],
    );
  }

  return {
    members: await listWorkspaceMembers(context),
    credentials: { username, email, password },
    emailDelivered: delivery.delivered,
    emailError: delivery.error,
  };
};

/**
 * Blocking is account-level: the member cannot sign in anywhere, and any live
 * session is refused at its next request. Suspension, by contrast, only closes
 * this one workspace and is set through updateWorkspaceMember.
 */
export const setMemberBlocked = async (
  context: WorkspaceContext,
  body: RecordValue,
) => {
  assertCanManage(context);
  const member = await targetMember(context, text(body.memberId, 36));
  const userId = text(member.user_id, 36);
  const blocked = body.blocked !== false;

  const sql = database();
  // An account this workspace did not create is not this workspace's to lock
  // out of the whole product; suspension is the right control there.
  if (blocked && member.provisioned !== true) {
    throw new MembersError(
      "This account was not created by your workspace, so it cannot be blocked from signing in. Suspend their access instead.",
      403,
      "member_not_provisioned",
    );
  }
  await sql.query(
    `UPDATE users
     SET blocked_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
         blocked_by = CASE WHEN $2 THEN $3::uuid ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, blocked, context.userId],
  );
  invalidateWorkspaceContext(userId);
  await recordMemberEvent({
    workspaceId: context.workspaceId,
    memberUserId: userId,
    memberLabel: text(member.email, 254),
    actorUserId: context.userId,
    action: blocked ? "member_blocked" : "member_unblocked",
  });
  return { members: await listWorkspaceMembers(context) };
};

/**
 * Deletes the account outright, not just its membership. Only offered for an
 * account this workspace created: one that existed beforehand is removed from
 * the workspace and left alone.
 *
 * Workspace content is unaffected -- everything a member creates is filed under
 * the workspace owner's id, so nothing is cascaded away with them.
 */
export const deleteMemberAccount = async (
  context: WorkspaceContext,
  body: RecordValue,
) => {
  assertCanManage(context);
  const member = await targetMember(context, text(body.memberId, 36));
  if (member.provisioned !== true) {
    throw new MembersError(
      "This account was not created by your workspace, so it cannot be deleted here. Remove them from the workspace instead.",
      403,
      "member_not_provisioned",
    );
  }
  const userId = text(member.user_id, 36);
  const sql = database();
  const elsewhere = await sql.query(
    `SELECT 1 FROM workspace_members
     WHERE user_id = $1 AND owner_id <> $2
     LIMIT 1`,
    [userId, context.workspaceId],
  );
  if (elsewhere.length > 0) {
    throw new MembersError(
      "This account belongs to another workspace too, so it cannot be deleted here.",
      409,
    );
  }
  await sql.query(
    `DELETE FROM invitations WHERE invited_by = $1 AND lower(email) = lower($2)`,
    [context.workspaceId, text(member.email, 254)],
  );
  // Recorded before the row goes: member_user_id becomes NULL on delete, and
  // member_label is what keeps the entry readable afterwards.
  await recordMemberEvent({
    workspaceId: context.workspaceId,
    memberUserId: userId,
    memberLabel: text(member.email, 254),
    actorUserId: context.userId,
    action: "member_account_deleted",
  });
  // profiles, workspace_members and reset tokens all cascade from users.
  await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
  invalidateWorkspaceContext(userId);
  return { members: await listWorkspaceMembers(context) };
};

export const removeWorkspaceMember = async (
  context: WorkspaceContext,
  body: RecordValue,
) => {
  assertCanManage(context);
  const member = await targetMember(context, text(body.memberId, 36));
  const sql = database();
  await sql.query(
    `DELETE FROM workspace_members WHERE id = $1 AND owner_id = $2 AND role <> 'owner'`,
    [text(member.id, 36), context.workspaceId],
  );
  // The invitation record, if one exists from the older flow, goes with it.
  await sql.query(
    `DELETE FROM invitations
     WHERE invited_by = $1 AND lower(email) = lower($2)`,
    [context.workspaceId, text(member.email, 254)],
  );
  invalidateWorkspaceContext(text(member.user_id, 36));
  await recordMemberEvent({
    workspaceId: context.workspaceId,
    memberUserId: text(member.user_id, 36),
    memberLabel: text(member.email, 254),
    actorUserId: context.userId,
    action: "member_removed",
  });
  await deliverMemberEmail({
    ownerId: context.workspaceId,
    to: text(member.email, 254),
    templateKey: "member_removed",
    variables: memberTemplateVariables({
      fullName: text(member.full_name, 255) || text(member.email, 254),
    }),
  });
  return { members: await listWorkspaceMembers(context) };
};

/**
 * Issues a new temporary password and mails it. Used when the first message
 * never arrived, or when a member is locked out.
 */
export const resetMemberCredentials = async (
  context: WorkspaceContext,
  body: RecordValue,
) => {
  assertCanManage(context);
  const member = await targetMember(context, text(body.memberId, 36));
  const userId = text(member.user_id, 36);
  const sql = database();

  const rows = await sql.query(
    `SELECT email, username, full_name FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const account = rows[0] as RecordValue | undefined;
  if (!account) throw new MembersError("This member could not be found.", 404);

  const email = text(account.email, 254);
  const fullName = text(account.full_name, 255) || email;
  let username = text(account.username, 60);
  if (!username) {
    username = await reserveUsername(fullName, email);
  }

  const password = generateMemberPassword();
  const passwordHash = await hash(password, 12);
  await sql.query(
    `UPDATE users
     SET password_hash = $1, username = $2, must_change_password = TRUE,
         updated_at = NOW()
     WHERE id = $3`,
    [passwordHash, username, userId],
  );
  // Any half-finished reset the member started is no longer valid.
  await sql.query(
    `UPDATE password_reset_tokens SET used = TRUE
     WHERE user_id = $1 AND used = FALSE`,
    [userId],
  );
  invalidateWorkspaceContext(userId);

  const grants = await sql.query(
    `SELECT allowed_modules FROM workspace_members
     WHERE owner_id = $1 AND user_id = $2 LIMIT 1`,
    [context.workspaceId, userId],
  );
  const stored = (grants[0] as RecordValue | undefined)?.allowed_modules;
  const delivery = await deliverMemberEmail({
    ownerId: context.workspaceId,
    to: email,
    templateKey: "member_password_reset",
    variables: memberTemplateVariables({
      fullName,
      username,
      email,
      modules: Array.isArray(stored)
        ? (stored.map(String) as WorkspaceModuleKey[])
        : null,
      password,
    }),
  });
  await sql.query(
    `UPDATE workspace_members SET credentials_sent_at = NOW()
     WHERE owner_id = $1 AND user_id = $2`,
    [context.workspaceId, userId],
  );
  await recordMemberEvent({
    workspaceId: context.workspaceId,
    memberUserId: userId,
    memberLabel: email,
    actorUserId: context.userId,
    action: "member_password_generated",
    detail: { emailed: delivery.delivered },
  });

  return {
    members: await listWorkspaceMembers(context),
    credentials: { username, email, password },
    emailDelivered: delivery.delivered,
    emailError: delivery.error,
  };
};

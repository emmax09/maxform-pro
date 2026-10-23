/**
 * End-to-end smoke test for workspace membership.
 *
 * Proves the claim the feature rests on: a member added by an owner signs in
 * with the credentials they were given, lands in *that owner's* workspace, and
 * can open exactly the tabs they were granted -- no more, and nothing of their
 * own.
 *
 * It drives the real HTTP handlers rather than the functions underneath them,
 * so routing, authentication and scoping are all covered. Everything it creates
 * is deleted again in the `finally` block, including on failure.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { hash } from "bcrypt-ts";

import { handleAuth } from "../server/auth";
import { handleSettings } from "../server/settings";
import { invalidateWorkspaceContext } from "../server/workspace-access";

const databaseUrl = process.env.DATABASE_URL || "";
const jwtSecret = process.env.JWT_SECRET || "";
if (!databaseUrl || jwtSecret.length < 32) {
  throw new Error(
    "Workspace members smoke test requires DATABASE_URL and a 32+ character JWT_SECRET.",
  );
}

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const ownerEmail = `members-smoke-owner-${suffix}@example.test`;
const memberEmail = `members-smoke-member-${suffix}@example.test`;
const memberUsername = `smoke.member.${suffix.slice(0, 6)}`;
const memberPassword = "Harbour-Lane-42x";

// Unique per run, so one run's sign-in attempts never count against the next.
const runClientAddress = [
  10,
  Math.floor(Math.random() * 256),
  Math.floor(Math.random() * 256),
  Math.floor(Math.random() * 254) + 1,
].join(".");

let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  assertions += 1;
  console.log(`  ok  ${message}`);
};

/** Minimal request/response pair the node-style handlers accept. */
const callHandler = async (
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>,
  options: { url: string; method?: string; token?: string; body?: unknown },
) => {
  const payload = options.body === undefined ? "" : JSON.stringify(options.body);
  const request = {
    url: options.url,
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers: {
      host: "127.0.0.1",
      // A per-run client address. Sign-in and password-reset are genuinely
      // rate limited per client, and Redis remembers across runs -- without
      // this, running the suite twice in a quarter of an hour fails on the
      // limiter rather than on anything it is testing.
      "x-forwarded-for": runClientAddress,
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    socket: { remoteAddress: runClientAddress },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  } as unknown as IncomingMessage;

  let status = 0;
  let raw = "";
  const response = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (chunk?: string) => {
      status = (response as { statusCode: number }).statusCode;
      raw = chunk || "";
    },
  } as unknown as ServerResponse & { statusCode: number };

  await handler(request, response);
  status = status || response.statusCode;
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = { raw };
  }
  return { status, body };
};

const ownerId = randomUUID();
let memberUserId = "";

const cleanup = async () => {
  const ids = [ownerId, memberUserId].filter(Boolean);
  for (const id of ids) {
    await sql.query(`DELETE FROM workspace_members WHERE owner_id = $1`, [id]);
    await sql.query(`DELETE FROM workspace_members WHERE user_id = $1`, [id]);
    await sql.query(`DELETE FROM invitations WHERE invited_by = $1`, [id]);
    await sql.query(`DELETE FROM email_logs WHERE user_id = $1`, [id]);
    await sql.query(
      `DELETE FROM workspace_member_events
       WHERE workspace_id = $1 OR member_user_id = $1 OR actor_user_id = $1`,
      [id],
    );
    await sql.query(`DELETE FROM users WHERE id = $1`, [id]);
  }
};

try {
  console.log("\nProvisioning a throwaway workspace owner");
  await sql.query(
    `INSERT INTO users (id, email, username, password_hash, full_name, short_id)
     VALUES ($1, $2, $3, $4, 'Smoke Owner', $5)`,
    [
      ownerId,
      ownerEmail,
      `smoke.owner.${suffix.slice(0, 6)}`,
      await hash("Owner-Password-99x", 12),
      suffix.slice(0, 5),
    ],
  );
  await sql.query(
    `INSERT INTO workspace_members (owner_id, user_id, role, status)
     VALUES ($1, $1, 'owner', 'active')
     ON CONFLICT (owner_id, user_id) DO NOTHING`,
    [ownerId],
  );
  await sql.query(
    `INSERT INTO company_settings (user_id, company_name)
     VALUES ($1, 'Smoke Workspace')
     ON CONFLICT (user_id) DO UPDATE SET company_name = EXCLUDED.company_name`,
    [ownerId],
  );
  invalidateWorkspaceContext();

  const ownerSignIn = await callHandler(handleAuth, {
    url: "/api/auth?action=sign-in",
    body: { identifier: ownerEmail, password: "Owner-Password-99x" },
  });
  check(ownerSignIn.status === 200, "owner can sign in");
  const ownerToken = String(
    (ownerSignIn.body as { access_token?: unknown }).access_token || "",
  );

  console.log("\nAdding a member with owner-chosen credentials and two tabs");
  const added = await callHandler(handleSettings, {
    url: "/api/settings?action=add-member",
    token: ownerToken,
    body: {
      email: memberEmail,
      fullName: "Smoke Member",
      role: "user",
      modules: ["forms", "events"],
      username: memberUsername,
      password: memberPassword,
    },
  });
  check(added.status === 200, `add-member returned 200 (got ${added.status})`);
  const members = (added.body.members || []) as Array<Record<string, unknown>>;
  const member = members.find((row) => row.email === memberEmail);
  check(Boolean(member), "the new member appears in the returned list");
  memberUserId = String(member?.userId || "");
  check(member?.username === memberUsername, "the owner's username was used");
  check(
    member?.provisioned === true,
    "the member is marked as provisioned by this workspace",
  );
  check(
    member?.pendingCredentials === false,
    "an owner-chosen password is not flagged as temporary",
  );

  console.log("\nMember signs in with the details they were given");
  const byUsername = await callHandler(handleAuth, {
    url: "/api/auth?action=sign-in",
    body: { identifier: memberUsername, password: memberPassword },
  });
  check(byUsername.status === 200, "member can sign in by username");
  const byEmail = await callHandler(handleAuth, {
    url: "/api/auth?action=sign-in",
    body: { identifier: memberEmail, password: memberPassword },
  });
  check(byEmail.status === 200, "member can sign in by email");
  const memberToken = String(
    (byEmail.body as { access_token?: unknown }).access_token || "",
  );

  console.log("\nThe session points at the owner's workspace, not a new one");
  const session = await callHandler(handleAuth, {
    url: "/api/auth?action=session",
    token: memberToken,
  });
  check(session.status === 200, "session loads for the member");
  const workspace = (session.body.workspace || {}) as Record<string, unknown>;
  check(
    workspace.id === ownerId,
    `member resolves to the owner's workspace (got ${String(workspace.id)})`,
  );
  check(
    workspace.name === "Smoke Workspace",
    "the workspace carries the owner's company name",
  );
  check(workspace.isOwner === false, "the member is not treated as an owner");
  check(
    workspace.canManageWorkspace === false,
    "the member cannot manage the workspace",
  );
  const granted = (workspace.allowedModules || []) as string[];
  check(
    granted.includes("forms") && granted.includes("events"),
    "granted tabs are present",
  );
  check(
    !granted.includes("payments") && !granted.includes("crm"),
    "ungranted tabs are absent",
  );
  check(
    granted.includes("home") && granted.includes("settings"),
    "home and settings are always granted",
  );

  console.log("\nWorkspace-level settings are refused for the member");
  const forbidden = await callHandler(handleSettings, {
    url: "/api/settings?action=members",
    token: memberToken,
  });
  check(forbidden.status === 403, "member cannot list members");
  const renameAttempt = await callHandler(handleSettings, {
    url: "/api/settings?action=workspace",
    token: memberToken,
    body: { companyName: "Hijacked" },
  });
  check(renameAttempt.status === 403, "member cannot rename the workspace");

  console.log("\nBut the member reads the workspace they belong to");
  const workspaceRead = await callHandler(handleSettings, {
    url: "/api/settings?action=workspace",
    token: memberToken,
  });
  check(workspaceRead.status === 200, "member can read workspace settings");
  const readWorkspace = (workspaceRead.body.workspace || {}) as Record<
    string,
    unknown
  >;
  check(
    readWorkspace.companyName === "Smoke Workspace",
    "member sees the owner's workspace, not an empty one",
  );

  console.log("\nMember changes their own password");
  const selfChange = await callHandler(handleAuth, {
    url: "/api/auth?action=update-password",
    token: memberToken,
    body: { currentPassword: memberPassword, newPassword: "Sel-Chosen-77x" },
  });
  check(selfChange.status === 200, "member can change their own password");
  const afterChange = await callHandler(handleAuth, {
    url: "/api/auth?action=sign-in",
    body: { identifier: memberUsername, password: "Sel-Chosen-77x" },
  });
  check(afterChange.status === 200, "the new password works");

  console.log("\nThe member can start a reset with either identifier");
  const resetByUsername = await callHandler(handleAuth, {
    url: "/api/auth?action=request-reset",
    body: { identifier: memberUsername },
  });
  check(resetByUsername.status === 200, "a reset can be requested by username");
  check(
    Boolean((resetByUsername.body as { token?: string }).token),
    "the username matched a real account, so a reset token was issued",
  );
  const resetByEmail = await callHandler(handleAuth, {
    url: "/api/auth?action=request-reset",
    body: { identifier: memberEmail },
  });
  check(resetByEmail.status === 200, "a reset can be requested by email");
  check(
    Boolean((resetByEmail.body as { token?: string }).token),
    "the address matched the same account",
  );
  // An identifier that matches nothing must answer identically, or the form
  // becomes a way to discover which usernames exist.
  const resetUnknown = await callHandler(handleAuth, {
    url: "/api/auth?action=request-reset",
    body: { identifier: "nobody.at.all.9x" },
  });
  check(
    resetUnknown.status === 200 &&
      !(resetUnknown.body as { token?: string }).token,
    "an unknown identifier answers the same way, with no token",
  );

  console.log("\nOwner sets a password on the member's behalf");
  const ownerSet = await callHandler(handleSettings, {
    url: "/api/settings?action=set-member-password",
    token: ownerToken,
    body: {
      memberId: String(member?.id),
      password: "Owner-Set-31x",
      notify: false,
    },
  });
  check(ownerSet.status === 200, "owner can set a member password");
  const withOwnerSet = await callHandler(handleAuth, {
    url: "/api/auth?action=sign-in",
    body: { identifier: memberUsername, password: "Owner-Set-31x" },
  });
  check(withOwnerSet.status === 200, "the owner-set password works");

  console.log("\nSuspension closes the workspace without deleting anything");
  const suspended = await callHandler(handleSettings, {
    url: "/api/settings?action=update-member",
    token: ownerToken,
    body: {
      memberId: String(member?.id),
      role: "user",
      modules: ["forms", "events"],
      status: "suspended",
    },
  });
  check(suspended.status === 200, "owner can suspend the member");
  invalidateWorkspaceContext();
  const suspendedSession = await callHandler(handleAuth, {
    url: "/api/auth?action=session",
    token: memberToken,
  });
  const suspendedWorkspace = (suspendedSession.body.workspace ||
    {}) as Record<string, unknown>;
  check(
    suspendedWorkspace.suspended === true,
    "the session reports the suspension",
  );
  check(
    Array.isArray(suspendedWorkspace.allowedModules) &&
      (suspendedWorkspace.allowedModules as string[]).length === 0,
    "a suspended member is granted no modules",
  );
  check(
    suspendedWorkspace.id === ownerId,
    "a suspended member still resolves to the right workspace, not a phantom one",
  );

  const restored = await callHandler(handleSettings, {
    url: "/api/settings?action=update-member",
    token: ownerToken,
    body: {
      memberId: String(member?.id),
      role: "user",
      modules: ["forms", "events"],
      status: "active",
    },
  });
  check(restored.status === 200, "owner can restore access");

  console.log("\nBlocking refuses sign-in outright");
  const blocked = await callHandler(handleSettings, {
    url: "/api/settings?action=block-member",
    token: ownerToken,
    body: { memberId: String(member?.id), blocked: true },
  });
  check(blocked.status === 200, "owner can block the member");
  invalidateWorkspaceContext();
  const blockedSignIn = await callHandler(handleAuth, {
    url: "/api/auth?action=sign-in",
    body: { identifier: memberUsername, password: "Owner-Set-31x" },
  });
  check(blockedSignIn.status === 403, "a blocked member cannot sign in");
  const blockedSession = await callHandler(handleAuth, {
    url: "/api/auth?action=session",
    token: memberToken,
  });
  check(
    blockedSession.status === 403,
    "a blocked member's existing session is refused",
  );
  const unblocked = await callHandler(handleSettings, {
    url: "/api/settings?action=block-member",
    token: ownerToken,
    body: { memberId: String(member?.id), blocked: false },
  });
  check(unblocked.status === 200, "owner can unblock the member");

  console.log("\nThe activity log records what happened, and who did it");
  const activity = await callHandler(handleSettings, {
    url: `/api/settings?action=member-activity&memberId=${String(member?.id)}`,
    token: ownerToken,
  });
  check(activity.status === 200, "owner can read a member's activity");
  const events = (activity.body.events || []) as Array<Record<string, unknown>>;
  const actions = events.map((event) => String(event.action));
  check(actions.includes("member_added"), "the add is recorded");
  check(actions.includes("member_signed_in"), "sign-ins are recorded");
  check(
    actions.includes("member_password_self_changed"),
    "a self-service password change is recorded",
  );
  check(
    actions.includes("member_password_set"),
    "an owner-set password is recorded",
  );
  check(actions.includes("member_suspended"), "suspension is recorded");
  check(actions.includes("member_restored"), "restoration is recorded");
  check(actions.includes("member_blocked"), "blocking is recorded");
  const addedEvent = events.find((event) => event.action === "member_added");
  check(
    JSON.stringify(addedEvent?.detail || {}).includes(memberPassword) === false,
    "the audit trail never stores the password itself",
  );
  const memberActivityAttempt = await callHandler(handleSettings, {
    url: `/api/settings?action=member-activity&memberId=${String(member?.id)}`,
    token: memberToken,
  });
  check(
    memberActivityAttempt.status === 403,
    "a member cannot read activity logs",
  );

  console.log("\nThe members list reports last-seen time");
  const listed = await callHandler(handleSettings, {
    url: "/api/settings?action=members",
    token: ownerToken,
  });
  const listedMembers = (listed.body.members || []) as Array<
    Record<string, unknown>
  >;
  const listedMember = listedMembers.find((row) => row.email === memberEmail);
  check(
    Boolean(listedMember?.lastActiveAt),
    "the member row carries a last-active time",
  );

  console.log("\nAn address that already has a workspace is refused");
  const duplicate = await callHandler(handleSettings, {
    url: "/api/settings?action=add-member",
    token: ownerToken,
    body: {
      email: memberEmail,
      fullName: "Smoke Member",
      role: "user",
      modules: ["forms"],
    },
  });
  check(duplicate.status === 409, "adding the same person twice is refused");

  console.log("\nDeleting the account removes it entirely");
  const deleted = await callHandler(handleSettings, {
    url: "/api/settings?action=delete-member-account",
    token: ownerToken,
    body: { memberId: String(member?.id) },
  });
  check(deleted.status === 200, "owner can delete a provisioned account");
  const gone = await sql.query(`SELECT 1 FROM users WHERE id = $1`, [
    memberUserId,
  ]);
  check(gone.length === 0, "the account row is gone");
  const goneSignIn = await callHandler(handleAuth, {
    url: "/api/auth?action=sign-in",
    body: { identifier: memberUsername, password: "Owner-Set-31x" },
  });
  check(goneSignIn.status === 401, "the deleted member can no longer sign in");

  console.log(`\n✓ Workspace members smoke test passed (${assertions} checks)`);
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  console.log("Cleaned up the throwaway owner and member.");
}

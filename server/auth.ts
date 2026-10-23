import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { compare, hash } from "bcrypt-ts";
import { jwtVerify, SignJWT } from "jose";

import { configuredAppUrl } from "./app-url";
import { consumeRateLimit } from "./rate-limit";
import {
  canManageWorkspace,
  invalidateWorkspaceContext,
  workspaceContextFor,
} from "./workspace-access";
import { recordMemberEvent } from "./workspace-member-events";
import { reserveUsername } from "./workspace-members";

type RecordValue = Record<string, unknown>;

class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "auth_error",
  ) {
    super(message);
  }
}

const attempts = new Map<string, { count: number; resetsAt: number }>();
const googleStateCookieName = "maxform_google_oauth_state";

// Excludes visually ambiguous characters (0/O, 1/l/I) so short ids stay
// readable when someone has to type or read one out loud.
const shortIdCharset =
  "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";

const generateShortId = () => {
  let id = "";
  for (let index = 0; index < 5; index += 1) {
    id += shortIdCharset[Math.floor(Math.random() * shortIdCharset.length)];
  }
  return id;
};

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new AuthError(
      "Account services are temporarily unavailable.",
      503,
      "auth_unavailable",
    );
  }
  return neon(url);
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new AuthError(
      "Account services are temporarily unavailable.",
      503,
      "auth_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const googleCredentials = () => {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new AuthError(
      "Google authentication is not configured yet.",
      503,
      "google_auth_unavailable",
    );
  }
  return { clientId, clientSecret };
};

const requestBaseUrl = (request: IncomingMessage) => {
  const configured = configuredAppUrl();
  if (configured) return configured;

  const forwardedHost = String(request.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(request.headers.host || "").trim();
  if (!host) {
    throw new AuthError(
      "Google authentication is temporarily unavailable.",
      503,
      "google_auth_unavailable",
    );
  }
  const forwardedProtocol = String(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const protocol =
    forwardedProtocol || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${protocol}://${host}`;
};

const googleRedirectUri = (request: IncomingMessage) =>
  `${requestBaseUrl(request)}/api/auth?action=google-callback`;

const cookieValues = (request: IncomingMessage) =>
  String(request.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .reduce<Record<string, string>>((values, part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) return values;
      const key = part.slice(0, separator);
      const value = part.slice(separator + 1);
      values[key] = decodeURIComponent(value);
      return values;
    }, {});

const googleStateCookie = (
  value: string,
  secure: boolean,
  maximumAge = 10 * 60,
) =>
  [
    `${googleStateCookieName}=${encodeURIComponent(value)}`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${maximumAge}`,
  ]
    .filter(Boolean)
    .join("; ");

const redirect = (response: ServerResponse, location: string) => {
  response.statusCode = 302;
  response.setHeader("Location", location);
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end();
};

const json = (
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64_000) {
      throw new AuthError("This account request is too large.", 413);
    }
  }
  if (!body) return {} as RecordValue;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid body");
    }
    return value as RecordValue;
  } catch {
    throw new AuthError("The account request could not be read.");
  }
};

const rateLimitWindowSeconds = 15 * 60;

const clientIdentifier = (request: IncomingMessage) => {
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || request.socket.remoteAddress || "unknown";
};

const tooManyAttempts = () =>
  new AuthError(
    "Too many attempts. Wait a few minutes and try again.",
    429,
    "auth_rate_limited",
  );

// Only reached when Redis is unavailable. A per-instance counter cannot see
// attempts served by other instances, so it is a floor, not the real limit.
const enforceLocalRateLimit = (key: string, maximum: number) => {
  const now = Date.now();
  if (attempts.size > 10_000) {
    for (const [entry, value] of attempts) {
      if (value.resetsAt <= now) attempts.delete(entry);
    }
  }
  const current = attempts.get(key);
  if (!current || current.resetsAt <= now) {
    attempts.set(key, {
      count: 1,
      resetsAt: now + rateLimitWindowSeconds * 1_000,
    });
    return;
  }
  if (current.count >= maximum) throw tooManyAttempts();
  current.count += 1;
};

const enforceRateLimit = async (
  request: IncomingMessage,
  action: string,
  maximum: number,
) => {
  const identifier = clientIdentifier(request);
  const limited = await consumeRateLimit({
    action: `auth:${action}`,
    identifier,
    limit: maximum,
    windowSeconds: rateLimitWindowSeconds,
  });
  if (limited.supported) {
    if (!limited.allowed) throw tooManyAttempts();
    return;
  }
  enforceLocalRateLimit(`${action}:${identifier}`, maximum);
};

const emailValue = (value: unknown) => {
  const email = String(value || "").trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new AuthError("Enter a valid email address.");
  }
  return email;
};

const passwordValue = (value: unknown, minimum = 8) => {
  const password = String(value || "");
  if (password.length < minimum || password.length > 128) {
    throw new AuthError(
      `Password must be between ${minimum} and 128 characters.`,
    );
  }
  return password;
};

const issueSession = async (user: RecordValue) => {
  const accessToken = await new SignJWT({
    email: String(user.email || ""),
    userId: String(user.id || ""),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("maxform")
    .setAudience("maxform-dashboard")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(signingSecret());
  const refreshToken = await new SignJWT({
    tokenType: "refresh",
    userId: String(user.id || ""),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("maxform")
    .setAudience("maxform-dashboard")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(signingSecret());
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username || "",
      full_name: user.full_name,
      phone: user.phone || "",
      short_id: user.short_id || "",
      created_at: user.created_at,
    },
    must_change_password: user.must_change_password === true,
  };
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    throw new AuthError(
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
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user");
    return userId;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
};

const profileFor = async (userId: string) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT user_account.id, user_account.email, user_account.username,
            user_account.full_name, user_account.phone, user_account.short_id,
            user_account.must_change_password, user_account.created_at,
            profile.id AS profile_id, profile.avatar_url, profile.job_title,
            profile.company, profile.country, profile.bio,
            profile.created_at AS profile_created_at,
            profile.updated_at AS profile_updated_at,
            COALESCE(role.role, 'user') AS role
     FROM users user_account
     LEFT JOIN profiles profile ON profile.user_id = user_account.id
     LEFT JOIN user_roles role ON role.user_id = user_account.id
     WHERE user_account.id = $1
     LIMIT 1`,
    [userId],
  );
  if (!rows[0]) {
    throw new AuthError(
      "Your account could not be found.",
      401,
      "authentication_required",
    );
  }
  const row = rows[0] as RecordValue;
  // Which workspace this session acts in, and which tabs it may open. The
  // dashboard renders its rail from this rather than assuming every signed-in
  // account owns everything it can see.
  const context = await workspaceContextFor(userId);
  // Blocking has to end the sessions that already exist, not just refuse the
  // next sign-in, so it is enforced here as well.
  if (context.blocked) {
    throw new AuthError(
      "This account has been blocked. Contact your workspace administrator.",
      403,
      "account_blocked",
    );
  }
  const workspaceRows = await sql.query(
    `SELECT COALESCE(NULLIF(company.company_name, ''), owner.full_name) AS name,
            owner.email AS owner_email
     FROM users owner
     LEFT JOIN company_settings company ON company.user_id = owner.id
     WHERE owner.id = $1
     LIMIT 1`,
    [context.workspaceId],
  );
  const workspaceRow = (workspaceRows[0] || {}) as RecordValue;
  return {
    profile: row.profile_id
      ? {
          id: row.profile_id,
          user_id: row.id,
          full_name: row.full_name,
          avatar_url: row.avatar_url || null,
          job_title: row.job_title || null,
          company: row.company || null,
          phone: row.phone || null,
          country: row.country || null,
          bio: row.bio || null,
          role: row.role,
          created_at: row.profile_created_at,
          updated_at: row.profile_updated_at,
        }
      : null,
    role: String(row.role || "user"),
    user: {
      id: row.id,
      email: row.email,
      username: row.username || "",
      full_name: row.full_name,
      phone: row.phone || "",
      short_id: row.short_id || "",
      created_at: row.created_at,
    },
    workspace: {
      id: context.workspaceId,
      name: String(workspaceRow.name || "") || "Workspace",
      ownerEmail: String(workspaceRow.owner_email || ""),
      role: context.role,
      isOwner: context.isOwner,
      canManageWorkspace: canManageWorkspace(context),
      allowedModules: context.allowedModules,
      mustChangePassword: context.mustChangePassword,
      suspended: context.suspended,
    },
  };
};

const signUp = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await enforceRateLimit(request, "signup", 5);
  const body = await readBody(request);
  const email = emailValue(body.email);
  const password = passwordValue(body.password);
  // Workspace name is the only name collected during sign-up. Accept the
  // legacy fullName key as a compatibility fallback for older clients.
  const workspaceName = String(
    body.workspaceName || body.fullName || "",
  )
    .trim()
    .slice(0, 255);
  const fullName = String(body.fullName || workspaceName)
    .trim()
    .slice(0, 255);
  const phone = String(body.phone || "").trim().slice(0, 50);
  const country = String(body.country || "").trim().slice(0, 100);
  if (workspaceName.length < 2) {
    throw new AuthError("Enter your workspace name.");
  }
  const passwordHash = await hash(password, 12);
  const sql = database();
  const userId = randomUUID();
  let shortId = generateShortId();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await sql.query(
      `SELECT 1 FROM users WHERE short_id = $1 LIMIT 1`,
      [shortId],
    );
    if (existing.length === 0) break;
    shortId = generateShortId();
  }
  const username = await reserveUsername(fullName, email);
  const rows = await sql.query(
    `WITH saved_user AS (
       INSERT INTO users (
         id, email, username, password_hash, full_name, phone, short_id,
         created_at, updated_at
       )
       VALUES ($1, $2, $8, $3, $4, $5, $7, NOW(), NOW())
       RETURNING id, email, username, full_name, phone, short_id,
                 must_change_password, created_at
     ),
     saved_profile AS (
       INSERT INTO profiles (
         user_id, full_name, phone, country, created_at, updated_at
       )
       SELECT id, full_name, phone, $6, NOW(), NOW()
       FROM saved_user
       RETURNING id
     ),
     saved_membership AS (
       INSERT INTO workspace_members (owner_id, user_id, role, status)
       SELECT id, id, 'owner', 'active' FROM saved_user
       ON CONFLICT (owner_id, user_id) DO NOTHING
       RETURNING id
     ),
     saved_workspace AS (
       INSERT INTO company_settings (user_id, company_name, created_at, updated_at)
       SELECT id, $9, NOW(), NOW() FROM saved_user
       ON CONFLICT (user_id) DO UPDATE SET
         company_name = CASE
           WHEN LENGTH(TRIM(COALESCE(company_settings.company_name, ''))) = 0
             THEN EXCLUDED.company_name
           ELSE company_settings.company_name
         END,
         updated_at = NOW()
       RETURNING id
     )
     SELECT * FROM saved_user`,
    [
      userId,
      email,
      passwordHash,
      fullName,
      phone || null,
      country || null,
      shortId,
      username,
      workspaceName,
    ],
  );
  json(response, 201, await issueSession(rows[0] as RecordValue));
};

/**
 * Sign-in accepts either an email address or a username. Members provisioned by
 * a workspace owner are given both, and the credentials mail shows both, so
 * whichever one they type has to work.
 */
export const signInIdentifier = (value: unknown) => {
  const identifier = String(value || "").trim().toLowerCase();
  if (!identifier || identifier.length > 254) {
    throw new AuthError("Enter your email address or username.");
  }
  if (identifier.includes("@")) return emailValue(identifier);
  if (!/^[a-z0-9._-]{3,60}$/.test(identifier)) {
    throw new AuthError("Enter your email address or username.");
  }
  return identifier;
};

const signIn = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await enforceRateLimit(request, "signin", 10);
  const body = await readBody(request);
  const identifier = signInIdentifier(body.identifier ?? body.email);
  const password = String(body.password || "");
  const sql = database();
  const rows = await sql.query(
    `SELECT id, email, username, password_hash, full_name, phone, short_id,
            must_change_password, blocked_at, created_at
     FROM users
     WHERE lower(email) = $1 OR lower(username) = $1
     LIMIT 1`,
    [identifier],
  );
  const user = rows[0] as RecordValue | undefined;
  const valid =
    Boolean(user) &&
    password.length <= 128 &&
    (await compare(password, String(user?.password_hash || "")));
  if (!valid) {
    throw new AuthError(
      "Those sign-in details are incorrect.",
      401,
      "invalid_credentials",
    );
  }
  // Checked after the password so a wrong guess cannot be used to discover
  // which addresses belong to blocked accounts.
  if (user?.blocked_at) {
    throw new AuthError(
      "This account has been blocked. Contact your workspace administrator.",
      403,
      "account_blocked",
    );
  }
  // Recorded so an administrator reviewing a member can see when they were
  // last here. Only for members of someone else's workspace -- an owner
  // signing into their own does not need auditing, and would only add noise.
  const signedIn = await workspaceContextFor(String(user!.id || ""));
  if (!signedIn.isOwner && signedIn.workspaceId !== signedIn.userId) {
    await recordMemberEvent({
      workspaceId: signedIn.workspaceId,
      memberUserId: signedIn.userId,
      memberLabel: String(user!.email || ""),
      action: "member_signed_in",
      detail: { via: identifier.includes("@") ? "email" : "username" },
    });
  }
  json(response, 200, await issueSession(user!));
};

const googleAuthResult = (
  response: ServerResponse,
  result:
    | { session: Awaited<ReturnType<typeof issueSession>> }
    | { error: string },
) => {
  const payload = JSON.stringify({
    type: "maxform:google-auth",
    ...result,
  }).replace(/</g, "\\u003c");
  const fallback = "error" in result
    ? `/auth?google_error=${encodeURIComponent(result.error)}`
    : "/dashboard";

  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Signing in to MaxForm</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #121214; color: #f8f8f7; }
      main { display: flex; align-items: center; gap: 12px; font-size: 14px; }
      span { width: 18px; height: 18px; border: 2px solid #4b4b50; border-top-color: #ff5a1f; border-radius: 999px; animation: spin .8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <main><span aria-hidden="true"></span>Completing your MaxForm sign-in…</main>
    <script>
      const result = ${payload};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(result, window.location.origin);
        window.setTimeout(() => window.close(), 80);
      } else if (result.session) {
        window.localStorage.setItem("access_token", result.session.access_token);
        window.localStorage.setItem("refresh_token", result.session.refresh_token);
        window.location.replace("/dashboard");
      } else {
        window.location.replace(${JSON.stringify(fallback)});
      }
    </script>
  </body>
</html>`);
};

const googleStart = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await enforceRateLimit(request, "google-auth-start", 20);
  const { clientId } = googleCredentials();
  const requestUrl = new URL(request.url || "/", "http://localhost");
  const intent =
    requestUrl.searchParams.get("intent") === "signup" ? "signup" : "signin";
  const nonce = randomBytes(24).toString("base64url");
  const state = await new SignJWT({ intent, nonce })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("maxform")
    .setAudience("maxform-google-auth")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(signingSecret());
  const baseUrl = requestBaseUrl(request);
  const authorizationUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", googleRedirectUri(request));
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("prompt", "select_account");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");

  response.setHeader(
    "Set-Cookie",
    googleStateCookie(nonce, baseUrl.startsWith("https://")),
  );
  redirect(response, authorizationUrl.toString());
};

const googleUser = async (profile: RecordValue) => {
  if (profile.email_verified !== true) {
    throw new AuthError(
      "Google could not verify this email address.",
      401,
      "google_email_unverified",
    );
  }
  const email = emailValue(profile.email);
  const suppliedName = String(
    profile.name ||
      [profile.given_name, profile.family_name].filter(Boolean).join(" ") ||
      email.split("@")[0],
  )
    .trim()
    .slice(0, 255);
  const fullName = suppliedName.length >= 2 ? suppliedName : "MaxForm User";
  const avatarUrl = String(profile.picture || "").trim().slice(0, 2_048);
  const sql = database();
  const existing = await sql.query(
    `SELECT id, email, username, full_name, phone, short_id,
            must_change_password, created_at
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [email],
  );

  if (existing[0]) {
    const user = existing[0] as RecordValue;
    await sql.query(
      `INSERT INTO workspace_members (owner_id, user_id, role, status)
       VALUES ($1, $1, 'owner', 'active')
       ON CONFLICT (owner_id, user_id) DO NOTHING`,
      [user.id],
    );
    const profiles = await sql.query(
      `SELECT id FROM profiles WHERE user_id = $1 LIMIT 1`,
      [user.id],
    );
    if (profiles[0]) {
      if (avatarUrl) {
        await sql.query(
          `UPDATE profiles
           SET avatar_url = COALESCE(avatar_url, $2), updated_at = NOW()
           WHERE user_id = $1`,
          [user.id, avatarUrl],
        );
      }
    } else {
      await sql.query(
        `INSERT INTO profiles (
           user_id, full_name, avatar_url, created_at, updated_at
         )
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [user.id, user.full_name || fullName, avatarUrl || null],
      );
    }
    return user;
  }

  const userId = randomUUID();
  const passwordHash = await hash(randomBytes(48).toString("base64url"), 12);
  let shortId = generateShortId();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shortIdMatch = await sql.query(
      `SELECT 1 FROM users WHERE short_id = $1 LIMIT 1`,
      [shortId],
    );
    if (shortIdMatch.length === 0) break;
    shortId = generateShortId();
  }

  const username = await reserveUsername(fullName, email);

  try {
    const rows = await sql.query(
      `WITH saved_user AS (
         INSERT INTO users (
           id, email, username, password_hash, full_name, phone, short_id,
           created_at, updated_at
         )
         VALUES ($1, $2, $7, $3, $4, NULL, $5, NOW(), NOW())
         RETURNING id, email, username, full_name, phone, short_id,
                   must_change_password, created_at
       ),
       saved_profile AS (
         INSERT INTO profiles (
           user_id, full_name, avatar_url, created_at, updated_at
         )
         SELECT id, full_name, $6, NOW(), NOW()
         FROM saved_user
         RETURNING id
       ),
       saved_membership AS (
         INSERT INTO workspace_members (owner_id, user_id, role, status)
         SELECT id, id, 'owner', 'active' FROM saved_user
         ON CONFLICT (owner_id, user_id) DO NOTHING
         RETURNING id
       )
       SELECT * FROM saved_user`,
      [userId, email, passwordHash, fullName, shortId, avatarUrl || null, username],
    );
    return rows[0] as RecordValue;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    if (code !== "23505") throw error;
    const rows = await sql.query(
      `SELECT id, email, username, full_name, phone, short_id,
              must_change_password, created_at
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email],
    );
    if (!rows[0]) throw error;
    return rows[0] as RecordValue;
  }
};

const googleCallback = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const baseUrl = requestBaseUrl(request);
  response.setHeader(
    "Set-Cookie",
    googleStateCookie("", baseUrl.startsWith("https://"), 0),
  );

  try {
    await enforceRateLimit(request, "google-auth-callback", 30);
    const { clientId, clientSecret } = googleCredentials();
    const requestUrl = new URL(request.url || "/", "http://localhost");
    const providerError = requestUrl.searchParams.get("error");
    if (providerError) {
      throw new AuthError(
        providerError === "access_denied"
          ? "Google sign-in was cancelled."
          : "Google could not complete sign-in.",
        400,
        "google_auth_failed",
      );
    }

    const code = String(requestUrl.searchParams.get("code") || "");
    const state = String(requestUrl.searchParams.get("state") || "");
    const savedNonce = cookieValues(request)[googleStateCookieName] || "";
    if (!code || !state || !savedNonce) {
      throw new AuthError(
        "Google sign-in could not be verified. Please try again.",
        400,
        "google_state_invalid",
      );
    }
    const { payload } = await jwtVerify(state, signingSecret(), {
      issuer: "maxform",
      audience: "maxform-google-auth",
    });
    if (String(payload.nonce || "") !== savedNonce) {
      throw new AuthError(
        "Google sign-in could not be verified. Please try again.",
        400,
        "google_state_invalid",
      );
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: googleRedirectUri(request),
      }),
    });
    const token = (await tokenResponse.json().catch(() => ({}))) as RecordValue;
    const accessToken = String(token.access_token || "");
    if (!tokenResponse.ok || !accessToken) {
      throw new AuthError(
        "Google could not complete sign-in. Please try again.",
        401,
        "google_token_invalid",
      );
    }

    const profileResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const profile = (await profileResponse
      .json()
      .catch(() => ({}))) as RecordValue;
    if (!profileResponse.ok) {
      throw new AuthError(
        "Google account details could not be loaded.",
        401,
        "google_profile_unavailable",
      );
    }

    const user = await googleUser(profile);
    googleAuthResult(response, { session: await issueSession(user) });
  } catch (error) {
    googleAuthResult(response, {
      error:
        error instanceof AuthError
          ? error.message
          : "Google sign-in is temporarily unavailable.",
    });
  }
};

const session = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const userId = await authenticatedUserId(request);
  json(response, 200, await profileFor(userId));
};

const requestReset = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await enforceRateLimit(request, "password-reset", 5);
  const body = await readBody(request);
  // A member provisioned by a workspace owner may only have their username to
  // hand, so the reset prompt accepts either. The response stays identical
  // whichever is given, and whether or not it matched.
  const identifier = signInIdentifier(body.identifier ?? body.email);
  const email = identifier.includes("@") ? identifier : "";
  const sql = database();
  const rows = await sql.query(
    `SELECT id, email FROM users
     WHERE lower(email) = $1 OR lower(username) = $1
     LIMIT 1`,
    [identifier],
  );
  let developmentToken = "";
  if (rows[0]) {
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await sql.query(
      `WITH expired AS (
         UPDATE password_reset_tokens
         SET used = TRUE
         WHERE user_id = $1 AND used = FALSE
         RETURNING id
       )
       INSERT INTO password_reset_tokens (
         user_id, token, expires_at, used, created_at
       )
       VALUES ($1, $2, NOW() + INTERVAL '1 hour', FALSE, NOW())`,
      [rows[0].id, tokenHash],
    );
    if (process.env.NODE_ENV !== "production") {
      developmentToken = rawToken;
    }
  }
  json(response, 200, {
    // Echoes back what was typed. Saying nothing about whether it matched is
    // the point -- this must not become an account-enumeration oracle.
    email: email || identifier,
    token: developmentToken,
    message:
      "If an account matches those details, password reset instructions are on the way.",
  });
};

const verifyReset = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const body = await readBody(request);
  const token = String(body.token || "");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const sql = database();
  const rows = await sql.query(
    `SELECT EXISTS (
       SELECT 1 FROM password_reset_tokens
       WHERE token = $1 AND used = FALSE AND expires_at > NOW()
     ) AS valid`,
    [tokenHash],
  );
  json(response, 200, { valid: rows[0]?.valid === true });
};

const resetPassword = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await enforceRateLimit(request, "password-reset-confirm", 10);
  const body = await readBody(request);
  const token = String(body.token || "");
  const password = passwordValue(body.newPassword);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const passwordHash = await hash(password, 12);
  const sql = database();
  const rows = await sql.query(
    `WITH claimed AS (
       UPDATE password_reset_tokens
       SET used = TRUE
       WHERE token = $1 AND used = FALSE AND expires_at > NOW()
       RETURNING user_id
     )
     UPDATE users user_account
     SET password_hash = $2, must_change_password = FALSE, updated_at = NOW()
     FROM claimed
     WHERE user_account.id = claimed.user_id
     RETURNING user_account.id`,
    [tokenHash, passwordHash],
  );
  if (!rows[0]) {
    throw new AuthError(
      "This reset link is invalid or has expired.",
      400,
      "invalid_reset",
    );
  }
  invalidateWorkspaceContext(String((rows[0] as RecordValue).id || ""));
  json(response, 200, { updated: true });
};

const updatePassword = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await enforceRateLimit(request, "password-update", 10);
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const currentPassword = String(body.currentPassword || "");
  const newPassword = passwordValue(body.newPassword);
  const sql = database();
  const rows = await sql.query(
    `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  if (
    !rows[0] ||
    !(await compare(
      currentPassword,
      String((rows[0] as RecordValue).password_hash || ""),
    ))
  ) {
    throw new AuthError(
      "Current password is incorrect.",
      401,
      "invalid_credentials",
    );
  }
  const passwordHash = await hash(newPassword, 12);
  await sql.query(
    `UPDATE users
     SET password_hash = $1, must_change_password = FALSE, updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, userId],
  );
  // Clears the "temporary password still in place" flag the dashboard reads.
  invalidateWorkspaceContext(userId);
  const changed = await workspaceContextFor(userId);
  if (!changed.isOwner && changed.workspaceId !== changed.userId) {
    await recordMemberEvent({
      workspaceId: changed.workspaceId,
      memberUserId: userId,
      action: "member_password_self_changed",
    });
  }
  json(response, 200, { updated: true });
};

const deleteAccount = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await enforceRateLimit(request, "account-delete", 5);
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const currentPassword = String(body.currentPassword || "");
  const sql = database();
  const rows = await sql.query(
    `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  if (
    !rows[0] ||
    !(await compare(
      currentPassword,
      String((rows[0] as RecordValue).password_hash || ""),
    ))
  ) {
    throw new AuthError(
      "Current password is incorrect.",
      401,
      "invalid_credentials",
    );
  }
  await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
  json(response, 200, { deleted: true });
};

export async function handleAuth(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "session";
    if (action === "sign-up" && request.method === "POST") {
      await signUp(request, response);
      return;
    }
    if (action === "sign-in" && request.method === "POST") {
      await signIn(request, response);
      return;
    }
    if (action === "google-start" && request.method === "GET") {
      await googleStart(request, response);
      return;
    }
    if (action === "google-config" && request.method === "GET") {
      googleCredentials();
      json(response, 200, { enabled: true });
      return;
    }
    if (action === "google-callback" && request.method === "GET") {
      await googleCallback(request, response);
      return;
    }
    if (action === "session" && request.method === "GET") {
      await session(request, response);
      return;
    }
    if (action === "request-reset" && request.method === "POST") {
      await requestReset(request, response);
      return;
    }
    if (action === "verify-reset" && request.method === "POST") {
      await verifyReset(request, response);
      return;
    }
    if (action === "reset-password" && request.method === "POST") {
      await resetPassword(request, response);
      return;
    }
    if (action === "update-password" && request.method === "POST") {
      await updatePassword(request, response);
      return;
    }
    if (action === "delete-account" && request.method === "POST") {
      await deleteAccount(request, response);
      return;
    }
    json(response, 404, { error: "This account action is not available." });
  } catch (error) {
    if (error instanceof AuthError) {
      json(response, error.status, { error: error.message, code: error.code });
      return;
    }
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    if (code === "23505") {
      json(response, 409, {
        error: "An account with that email already exists.",
        code: "account_exists",
      });
      return;
    }
    json(response, 500, {
      error: "Account services are temporarily unavailable.",
      code: "auth_error",
    });
  }
}

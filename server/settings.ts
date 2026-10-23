import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import {
  countryCodeForRegionalValue,
  currencyOption,
  isSupportedCountryCurrency,
  isSupportedTimezone,
  regionalDefaultsForCountry,
} from "../src/lib/regional-options";
import {
  canManageWorkspace,
  workspaceContextFor,
  type WorkspaceContext,
} from "./workspace-access";
import {
  addWorkspaceMember,
  deleteMemberAccount,
  getMemberActivity,
  listWorkspaceMembers,
  MembersError,
  removeWorkspaceMember,
  resetMemberCredentials,
  setMemberBlocked,
  setMemberPassword,
  updateWorkspaceMember,
} from "./workspace-members";

type RecordValue = Record<string, unknown>;

class SettingsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "settings_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new SettingsError(
      "Workspace settings are temporarily unavailable.",
      503,
      "settings_unavailable",
    );
  }
  return neon(url);
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new SettingsError(
      "Workspace settings are temporarily unavailable.",
      503,
      "settings_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
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

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    throw new SettingsError(
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
    if (error instanceof SettingsError) throw error;
    throw new SettingsError(
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
    if (body.length > 3_000_000) {
      throw new SettingsError("This workspace update is too large.", 413);
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
    throw new SettingsError("The workspace update could not be read.");
  }
};

const text = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

const nullableText = (value: unknown, maximum: number) =>
  text(value, maximum) || null;

const composeWorkspaceAddress = (parts: {
  addressLine1?: unknown;
  addressLine2?: unknown;
  city?: unknown;
  stateRegion?: unknown;
  postalCode?: unknown;
  country?: unknown;
}) =>
  [
    text(parts.addressLine1, 200),
    text(parts.addressLine2, 200),
    [text(parts.city, 120), text(parts.stateRegion, 120)]
      .filter(Boolean)
      .join(", "),
    text(parts.postalCode, 40),
    text(parts.country, 120),
  ]
    .filter(Boolean)
    .join(", ");

const boolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const brandColor = (value: unknown) => {
  const result = String(value || "#236BFE").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(result) ? result : "#236BFE";
};

const logoUrl = (value: unknown) => {
  const result = String(value || "").trim();
  if (!result) return null;
  if (result.length > 2_500_000) {
    throw new SettingsError("Choose a workspace image smaller than 2 MB.");
  }
  if (
    !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(result) &&
    !/^https:\/\//i.test(result)
  ) {
    throw new SettingsError("Choose a valid workspace image.");
  }
  return result;
};

const workspaceFor = async (userId: string) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT company.company_name, company.company_logo_url,
            company.company_website, company.industry, company.company_size,
            company.address, company.address_line1, company.address_line2,
            company.city, company.state_region, company.postal_code,
            COALESCE(company.country, profile.country) AS country,
            company.phone, company.brand_color,
            user_account.full_name
     FROM users user_account
     LEFT JOIN company_settings company ON company.user_id = user_account.id
     LEFT JOIN profiles profile ON profile.user_id = user_account.id
     WHERE user_account.id = $1
     LIMIT 1`,
    [userId],
  );
  const row = (rows[0] || {}) as RecordValue;
  const fullName = text(row.full_name, 255) || "My";
  const legacyAddress = text(row.address, 1_000);
  const addressLine1 = text(row.address_line1, 200) || legacyAddress;
  const addressLine2 = text(row.address_line2, 200);
  const city = text(row.city, 120);
  const stateRegion = text(row.state_region, 120);
  const postalCode = text(row.postal_code, 40);
  const country = text(row.country, 120);
  const address =
    composeWorkspaceAddress({
      addressLine1,
      addressLine2,
      city,
      stateRegion,
      postalCode,
      country,
    }) || legacyAddress;
  return {
    address,
    addressLine1,
    addressLine2,
    brandColor: brandColor(row.brand_color),
    city,
    companyLogoUrl: text(row.company_logo_url, 2_500_000) || null,
    companyName:
      text(row.company_name, 255) || `${fullName.split(/\s+/)[0]}'s workspace`,
    companySize: text(row.company_size, 50),
    companyWebsite: text(row.company_website, 255),
    country,
    industry: text(row.industry, 100),
    phone: text(row.phone, 50),
    postalCode,
    stateRegion,
  };
};

const saveWorkspace = async (userId: string, body: RecordValue) => {
  const companyName = text(body.companyName, 255);
  if (!companyName) throw new SettingsError("Enter a workspace name.");
  const addressParts = {
    addressLine1: nullableText(body.addressLine1, 200),
    addressLine2: nullableText(body.addressLine2, 200),
    city: nullableText(body.city, 120),
    stateRegion: nullableText(body.stateRegion, 120),
    postalCode: nullableText(body.postalCode, 40),
    country: nullableText(body.country, 120),
  };
  const hasStructuredAddress = [
    "addressLine1",
    "addressLine2",
    "city",
    "stateRegion",
    "postalCode",
    "country",
  ].some((key) => Object.prototype.hasOwnProperty.call(body, key));
  const address = hasStructuredAddress
    ? composeWorkspaceAddress(addressParts) || null
    : nullableText(body.address, 1_000);
  const values = [
    companyName,
    logoUrl(body.companyLogoUrl),
    nullableText(body.companyWebsite, 255),
    nullableText(body.companySize, 50),
    nullableText(body.industry, 100),
    address,
    addressParts.addressLine1,
    addressParts.addressLine2,
    addressParts.city,
    addressParts.stateRegion,
    addressParts.postalCode,
    addressParts.country,
    nullableText(body.phone, 50),
    brandColor(body.brandColor),
  ];
  const sql = database();
  await sql.query(
    `INSERT INTO company_settings (
       user_id, company_name, company_logo_url, company_website, company_size,
       industry, address, address_line1, address_line2, city, state_region,
       postal_code, country, phone, brand_color, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       company_name = EXCLUDED.company_name,
       company_logo_url = EXCLUDED.company_logo_url,
       company_website = EXCLUDED.company_website,
       company_size = EXCLUDED.company_size,
       industry = EXCLUDED.industry,
       address = EXCLUDED.address,
       address_line1 = EXCLUDED.address_line1,
       address_line2 = EXCLUDED.address_line2,
       city = EXCLUDED.city,
       state_region = EXCLUDED.state_region,
       postal_code = EXCLUDED.postal_code,
       country = EXCLUDED.country,
       phone = EXCLUDED.phone,
       brand_color = EXCLUDED.brand_color,
       updated_at = NOW()`,
    [userId, ...values],
  );
  return workspaceFor(userId);
};

const saveProfile = async (userId: string, body: RecordValue) => {
  const fullName = text(body.fullName, 255);
  if (fullName.length < 2) throw new SettingsError("Enter your full name.");
  const phone = nullableText(body.phone, 50);
  const values = [
    fullName,
    logoUrl(body.avatarUrl),
    nullableText(body.jobTitle, 100),
    nullableText(body.company, 255),
    phone,
    nullableText(body.country, 100),
    nullableText(body.bio, 1_000),
  ];
  const sql = database();
  await sql.query(
    `WITH updated_user AS (
       UPDATE users
       SET full_name = $2, phone = $6, updated_at = NOW()
       WHERE id = $1
     )
     INSERT INTO profiles (
       user_id, full_name, avatar_url, job_title, company, phone, country, bio,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       full_name = EXCLUDED.full_name,
       avatar_url = EXCLUDED.avatar_url,
       job_title = EXCLUDED.job_title,
       company = EXCLUDED.company,
       phone = EXCLUDED.phone,
       country = EXCLUDED.country,
       bio = EXCLUDED.bio,
       updated_at = NOW()`,
    [userId, ...values],
  );
};

const regionalFor = async (userId: string) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT regional.currency, regional.currency_country_code,
            regional.timezone,
            COALESCE(company.country, profile.country) AS country
     FROM users user_account
     LEFT JOIN profiles profile ON profile.user_id = user_account.id
     LEFT JOIN company_settings company ON company.user_id = user_account.id
     LEFT JOIN workspace_regional_settings regional
       ON regional.user_id = user_account.id
     WHERE user_account.id = $1
     LIMIT 1`,
    [userId],
  );
  const row = (rows[0] || {}) as RecordValue;
  if (row.currency) {
    return {
      currency: text(row.currency, 3) || "USD",
      currencyCountryCode:
        text(row.currency_country_code, 2).toUpperCase() || null,
      timezone: text(row.timezone, 100) || "UTC",
    };
  }
  const defaults = regionalDefaultsForCountry(text(row.country, 100));
  const result = {
    currency: defaults.currency,
    currencyCountryCode: defaults.countryCode,
    timezone: defaults.timezone,
  };
  await sql.query(
    `INSERT INTO workspace_regional_settings (
       user_id, currency, currency_country_code, timezone, created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, result.currency, result.currencyCountryCode, result.timezone],
  );
  return result;
};

const saveRegional = async (userId: string, body: RecordValue) => {
  const currency = text(body.currency, 3).toUpperCase();
  const countryCode =
    text(body.currencyCountryCode, 2).toUpperCase() ||
    countryCodeForRegionalValue(text(body.country, 100));
  const timezone = text(body.timezone, 100);
  if (
    !/^[A-Z]{3}$/.test(currency) ||
    !currencyOption(currency) ||
    !isSupportedCountryCurrency(countryCode, currency)
  ) {
    throw new SettingsError("Choose a valid country and currency.");
  }
  if (!timezone || !isSupportedTimezone(timezone)) {
    throw new SettingsError("Choose a valid time zone.");
  }
  const sql = database();
  await sql.query(
    `INSERT INTO workspace_regional_settings (
       user_id, currency, currency_country_code, timezone, created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       currency = EXCLUDED.currency,
       currency_country_code = EXCLUDED.currency_country_code,
       timezone = EXCLUDED.timezone,
       updated_at = NOW()`,
    [userId, currency, countryCode, timezone],
  );
  return { currency, currencyCountryCode: countryCode, timezone };
};

const notificationsFor = async (userId: string) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT email_on_new_submission, email_on_workflow_trigger,
            email_on_payment_received, daily_digest
     FROM notification_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  const row = (rows[0] || {}) as RecordValue;
  return {
    dailyDigest: boolean(row.daily_digest, false),
    emailOnNewSubmission: boolean(row.email_on_new_submission, true),
    emailOnPaymentReceived: boolean(row.email_on_payment_received, true),
    emailOnWorkflowTrigger: boolean(row.email_on_workflow_trigger, true),
  };
};

const saveNotifications = async (userId: string, body: RecordValue) => {
  const values = [
    boolean(body.emailOnNewSubmission, true),
    boolean(body.emailOnWorkflowTrigger, true),
    boolean(body.emailOnPaymentReceived, true),
    boolean(body.dailyDigest, false),
  ];
  const sql = database();
  await sql.query(
    `INSERT INTO notification_preferences (
       user_id, email_on_new_submission, email_on_workflow_trigger,
       email_on_payment_received, daily_digest, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       email_on_new_submission = EXCLUDED.email_on_new_submission,
       email_on_workflow_trigger = EXCLUDED.email_on_workflow_trigger,
       email_on_payment_received = EXCLUDED.email_on_payment_received,
       daily_digest = EXCLUDED.daily_digest,
       updated_at = NOW()`,
    [userId, ...values],
  );
  return notificationsFor(userId);
};

const invitationsFor = async (userId: string) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT id, email, role, created_at, expires_at
     FROM invitations
     WHERE invited_by = $1 AND status = 'pending'
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((row) => ({
    createdAt: row.created_at,
    email: row.email,
    expiresAt: row.expires_at,
    id: row.id,
    role: row.role,
  }));
};

const createInvitation = async (userId: string, body: RecordValue) => {
  const email = text(body.email, 254).toLowerCase();
  const role = ["admin", "moderator", "user"].includes(String(body.role))
    ? String(body.role)
    : "user";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SettingsError("Enter a valid email address.");
  }
  const sql = database();
  try {
    const rows = await sql.query(
      `INSERT INTO invitations (email, invited_by, role, status)
       SELECT $1, $2, $3, 'pending'
       WHERE NOT EXISTS (
         SELECT 1
         FROM invitations
         WHERE invited_by = $2
           AND LOWER(email) = LOWER($1)
           AND status = 'pending'
       )
       RETURNING id`,
      [email, userId, role],
    );
    if (rows.length === 0) {
      throw new SettingsError(
        "A pending invitation already exists for this email.",
        409,
      );
    }
  } catch {
    if (
      await sql
        .query(
          `SELECT 1
           FROM invitations
           WHERE invited_by = $1
             AND LOWER(email) = LOWER($2)
             AND status = 'pending'
           LIMIT 1`,
          [userId, email],
        )
        .then((rows) => rows.length > 0)
        .catch(() => false)
    ) {
      throw new SettingsError(
        "A pending invitation already exists for this email.",
        409,
      );
    }
    throw new SettingsError("The invitation could not be created.");
  }
  return invitationsFor(userId);
};

/**
 * Everything the Billing & usage screen needs, all derived from real rows.
 * A workspace with no subscription row is treated as being on the trial, which
 * is what a brand new signup is.
 */
const startOfMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

const endOfMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
};

const usageFor = async (userId: string) => {
  const sql = database();

  const subscriptionRows = await sql.query(
    `SELECT plan, status, period_start, period_end, extra_storage_bytes,
       extra_emails, cancel_at_period_end
     FROM workspace_subscriptions WHERE user_id = $1`,
    [userId],
  );
  const subscription = (subscriptionRows[0] || {}) as RecordValue;
  const plan = text(subscription.plan, 20) || "trial";
  const periodStart = subscription.period_start
    ? new Date(String(subscription.period_start))
    : startOfMonth();
  const periodEnd = subscription.period_end
    ? new Date(String(subscription.period_end))
    : endOfMonth();

  const rows = await sql.query(
    `SELECT
       (SELECT COUNT(*) FROM forms WHERE created_by = $1)::int AS forms,
       (
         SELECT COUNT(*)
         FROM form_submissions submission
         JOIN forms form ON form.id = submission.form_id
         WHERE form.created_by = $1
           AND COALESCE(submission.data #>> '{_meta,status}', 'completed')
             <> 'pending_payment'
       )::int AS responses,
       (SELECT COUNT(*) FROM workflows WHERE created_by = $1)::int AS workflows,
       (SELECT COUNT(*) FROM contacts WHERE created_by = $1)::int AS contacts`,
    [userId],
  );
  const row = (rows[0] || {}) as RecordValue;

  const storageRows = await sql.query(
    `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used_bytes
     FROM workspace_files
     WHERE user_id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  const emailRows = await sql.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE status IN ('sent', 'delivered', 'opened', 'clicked')
       )::int AS sent,
       COUNT(*) FILTER (WHERE provider <> '')::int AS own_provider
     FROM email_logs
     WHERE user_id = $1 AND created_at >= $2`,
    [userId, periodStart.toISOString()],
  );
  const creditRows = await sql.query(
    `SELECT
       COALESCE(SUM(delta) FILTER (
         WHERE expires_at IS NULL OR expires_at > NOW()
       ), 0)::int AS balance,
       COALESCE(-SUM(delta) FILTER (
         WHERE kind = 'spend' AND created_at >= $2
       ), 0)::int AS spent_this_period,
       COALESCE(SUM(delta) FILTER (
         WHERE kind = 'pack_purchase' AND (expires_at IS NULL OR expires_at > NOW())
       ), 0)::int AS purchased
     FROM workspace_credit_ledger
     WHERE user_id = $1`,
    [userId, periodStart.toISOString()],
  );
  const spendRows = await sql.query(
    `SELECT action, COALESCE(-SUM(delta), 0)::int AS credits, COUNT(*)::int AS runs
     FROM workspace_credit_ledger
     WHERE user_id = $1 AND kind = 'spend' AND created_at >= $2
     GROUP BY action
     ORDER BY credits DESC
     LIMIT 10`,
    [userId, periodStart.toISOString()],
  );
  const billingRows = await sql.query(
    `SELECT id, kind, description, amount_cents, currency, status, created_at
     FROM workspace_billing_events
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [userId],
  );

  const storage = (storageRows[0] || {}) as RecordValue;
  const emails = (emailRows[0] || {}) as RecordValue;
  const credits = (creditRows[0] || {}) as RecordValue;

  return {
    forms: Number(row.forms || 0),
    responses: Number(row.responses || 0),
    workflows: Number(row.workflows || 0),
    contacts: Number(row.contacts || 0),
    subscription: {
      plan,
      status: text(subscription.status, 20) || "trialing",
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      extraStorageBytes: Number(subscription.extra_storage_bytes || 0),
      extraEmails: Number(subscription.extra_emails || 0),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    },
    storage: { usedBytes: Number(storage.used_bytes || 0) },
    emails: {
      sent: Number(emails.sent || 0),
      ownProvider: Number(emails.own_provider || 0),
    },
    credits: {
      balance: Number(credits.balance || 0),
      spentThisPeriod: Number(credits.spent_this_period || 0),
      purchased: Number(credits.purchased || 0),
      breakdown: spendRows.map((entry) => {
        const value = entry as RecordValue;
        return {
          action: text(value.action, 60) || "AI request",
          credits: Number(value.credits || 0),
          runs: Number(value.runs || 0),
        };
      }),
    },
    billingHistory: billingRows.map((entry) => {
      const value = entry as RecordValue;
      return {
        id: String(value.id || ""),
        kind: text(value.kind, 20),
        description: text(value.description, 200),
        amountCents: Number(value.amount_cents || 0),
        currency: text(value.currency, 8) || "USD",
        status: text(value.status, 20),
        createdAt: String(value.created_at || ""),
      };
    }),
  };
};

/**
 * Workspace-level settings belong to the workspace, not to whoever is looking
 * at them. A member opening this screen must not be able to rename the company
 * or provision another member.
 */
const assertWorkspaceAdmin = (context: WorkspaceContext) => {
  if (!canManageWorkspace(context)) {
    throw new SettingsError(
      "Only the workspace owner or an admin can change this.",
      403,
      "settings_forbidden",
    );
  }
};

export async function handleSettings(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const userId = await authenticatedUserId(request);
    const context = await workspaceContextFor(userId);
    // Workspace rows are keyed by the owner. A member reads and writes the
    // workspace they belong to; for an owner the two ids are the same value.
    const workspaceId = context.workspaceId;
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "";
    const body = request.method === "POST" ? await readBody(request) : {};

    if (action === "workspace" && request.method === "GET") {
      json(response, 200, { workspace: await workspaceFor(workspaceId) });
      return;
    }
    if (action === "workspace" && request.method === "POST") {
      assertWorkspaceAdmin(context);
      json(response, 200, {
        workspace: await saveWorkspace(workspaceId, body),
      });
      return;
    }
    if (action === "profile" && request.method === "POST") {
      await saveProfile(userId, body);
      json(response, 200, { saved: true });
      return;
    }
    if (action === "regional" && request.method === "GET") {
      json(response, 200, { regional: await regionalFor(workspaceId) });
      return;
    }
    if (action === "regional" && request.method === "POST") {
      assertWorkspaceAdmin(context);
      json(response, 200, { regional: await saveRegional(workspaceId, body) });
      return;
    }
    if (action === "notifications" && request.method === "GET") {
      json(response, 200, {
        notifications: await notificationsFor(userId),
      });
      return;
    }
    if (action === "notifications" && request.method === "POST") {
      json(response, 200, {
        notifications: await saveNotifications(userId, body),
      });
      return;
    }
    if (action === "members" && request.method === "GET") {
      assertWorkspaceAdmin(context);
      json(response, 200, { members: await listWorkspaceMembers(context) });
      return;
    }
    if (action === "member-activity" && request.method === "GET") {
      json(
        response,
        200,
        await getMemberActivity(
          context,
          text(url.searchParams.get("memberId"), 36),
        ),
      );
      return;
    }
    if (action === "add-member" && request.method === "POST") {
      json(response, 200, await addWorkspaceMember(context, body));
      return;
    }
    if (action === "update-member" && request.method === "POST") {
      json(response, 200, await updateWorkspaceMember(context, body));
      return;
    }
    if (action === "remove-member" && request.method === "POST") {
      json(response, 200, await removeWorkspaceMember(context, body));
      return;
    }
    if (action === "reset-member-credentials" && request.method === "POST") {
      json(response, 200, await resetMemberCredentials(context, body));
      return;
    }
    if (action === "set-member-password" && request.method === "POST") {
      json(response, 200, await setMemberPassword(context, body));
      return;
    }
    if (action === "block-member" && request.method === "POST") {
      json(response, 200, await setMemberBlocked(context, body));
      return;
    }
    if (action === "delete-member-account" && request.method === "POST") {
      json(response, 200, await deleteMemberAccount(context, body));
      return;
    }
    if (action === "invitations" && request.method === "GET") {
      assertWorkspaceAdmin(context);
      json(response, 200, { invitations: await invitationsFor(workspaceId) });
      return;
    }
    if (action === "invitations" && request.method === "POST") {
      assertWorkspaceAdmin(context);
      json(response, 200, {
        invitations: await createInvitation(workspaceId, body),
      });
      return;
    }
    if (action === "revoke-invitation" && request.method === "POST") {
      assertWorkspaceAdmin(context);
      const invitationId = text(body.id, 36);
      if (!isUuid(invitationId)) {
        throw new SettingsError("This invitation could not be found.", 404);
      }
      const sql = database();
      await sql.query(
        `DELETE FROM invitations WHERE id = $1 AND invited_by = $2`,
        [invitationId, workspaceId],
      );
      json(response, 200, { removed: true });
      return;
    }
    if (action === "usage" && request.method === "GET") {
      json(response, 200, { usage: await usageFor(workspaceId) });
      return;
    }
    json(response, 404, { error: "This settings action is not available." });
  } catch (error) {
    if (error instanceof SettingsError || error instanceof MembersError) {
      json(response, error.status, { error: error.message, code: error.code });
      return;
    }
    json(response, 500, {
      error: "Workspace settings could not be updated. Please try again.",
      code: "settings_failed",
    });
  }
}

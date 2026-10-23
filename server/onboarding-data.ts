/**
 * New-user onboarding.
 *
 * The flow saves after every step rather than only at the end, so a signup
 * interrupted halfway resumes where it stopped instead of starting over. The
 * business address collected here is the same address Campaigns needs for the
 * compliance footer, which is why it is asked once, at the start, rather than
 * demanded later at the moment someone is trying to send.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";
import { workspaceScopeFor } from "./workspace-access";

type DatabaseRow = Record<string, unknown>;

export class OnboardingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "onboarding_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new OnboardingError(
      "Account setup is temporarily unavailable.",
      503,
      "onboarding_unavailable",
    );
  }
  return neon(url);
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new OnboardingError(
      "Account setup is temporarily unavailable.",
      503,
      "onboarding_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const cleanText = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

const json = (
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = cleanText(request.headers.authorization, 4_096);
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) {
    throw new OnboardingError(
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
    const userId = cleanText(payload.userId, 64);
    if (!isUuid(userId)) throw new Error("Invalid user");
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch (error) {
    if (error instanceof OnboardingError) throw error;
    throw new OnboardingError(
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
    if (body.length > 100_000) {
      throw new OnboardingError("This request is too large.", 413);
    }
  }
  if (!body) return {} as Record<string, unknown>;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid request");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new OnboardingError("This request could not be read.");
  }
};

const stringList = (value: unknown, maximum = 12) =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((entry) => cleanText(entry, 60))
            .filter(Boolean),
        ),
      ).slice(0, maximum)
    : [];

const jsonList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
      return [];
    }
  }
  return [];
};

/** The workspace default, matching server/settings.ts. */
const DEFAULT_BRAND_COLOR = "#236BFE";

const brandColorValue = (value: unknown) => {
  const result = String(value ?? "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(result) ? result : "";
};

/**
 * Accepts the same shapes company_settings does — an inline data URI from a
 * file picker, or an https URL. Anything else is rejected rather than stored,
 * so a logo can never become a vector for arbitrary markup.
 */
const brandLogoValue = (value: unknown) => {
  const result = String(value ?? "").trim();
  if (!result) return "";
  if (result.length > 2_500_000) {
    throw new OnboardingError("Choose a logo smaller than 2 MB.");
  }
  if (
    !/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,/i.test(result) &&
    !/^https:\/\//i.test(result)
  ) {
    throw new OnboardingError("Choose a valid image for your logo.");
  }
  return result;
};

export type OnboardingState = {
  businessName: string;
  businessType: string;
  industry: string;
  brandColor: string;
  logoUrl: string;
  teamSize: string;
  websiteUrl: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateRegion: string;
  postalCode: string;
  country: string;
  goals: string[];
  modules: string[];
  referralSource: string;
  currentStep: number;
  completed: boolean;
  skipped: boolean;
  /** The composed one-line postal address other modules read. */
  mailingAddress: string;
};

/**
 * Composes the address parts into the single line a compliance footer prints.
 * Empty parts are dropped so a partially answered address never renders with
 * stray commas.
 */
export const composeMailingAddress = (row: {
  businessName?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  city?: unknown;
  stateRegion?: unknown;
  postalCode?: unknown;
  country?: unknown;
}) =>
  [
    cleanText(row.businessName, 160),
    cleanText(row.addressLine1, 200),
    cleanText(row.addressLine2, 200),
    [cleanText(row.city, 120), cleanText(row.stateRegion, 120)]
      .filter(Boolean)
      .join(", "),
    cleanText(row.postalCode, 40),
    cleanText(row.country, 120),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");

const stateFor = (row: DatabaseRow | undefined): OnboardingState => {
  const value = {
    businessName: cleanText(row?.business_name, 160),
    businessType: cleanText(row?.business_type, 60),
    industry: cleanText(row?.industry, 100),
    // Reported empty when unchosen rather than defaulted, so a resumed signup
    // still shows the brand question as unanswered.
    brandColor: brandColorValue(row?.brand_color),
    logoUrl: String(row?.logo_url ?? ""),
    teamSize: cleanText(row?.team_size, 40),
    websiteUrl: cleanText(row?.website_url, 300),
    addressLine1: cleanText(row?.address_line1, 200),
    addressLine2: cleanText(row?.address_line2, 200),
    city: cleanText(row?.city, 120),
    stateRegion: cleanText(row?.state_region, 120),
    postalCode: cleanText(row?.postal_code, 40),
    country: cleanText(row?.country, 120),
    goals: jsonList(row?.goals),
    modules: jsonList(row?.modules),
    referralSource: cleanText(row?.referral_source, 60),
    currentStep: Math.max(0, Number(row?.current_step || 0)),
    completed: Boolean(row?.completed_at),
    skipped: Boolean(row?.skipped_at),
  };
  return { ...value, mailingAddress: composeMailingAddress(value) };
};

export async function getOnboarding(userId: string) {
  const rows = (await database().query(
    `SELECT * FROM user_onboarding WHERE user_id = $1 LIMIT 1`,
    [userId],
  )) as DatabaseRow[];
  return stateFor(rows[0]);
}

/**
 * Upserts whatever the current step supplied. Only the keys present in the
 * payload are written, so a later step can never blank an earlier answer.
 */
export async function saveOnboarding(
  userId: string,
  input: Record<string, unknown>,
) {
  const step = Math.max(0, Math.min(20, Number(input.currentStep) || 0));
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);

  await database().query(
    `INSERT INTO user_onboarding (
       user_id, business_name, business_type, industry, brand_color, logo_url,
       team_size, website_url,
       address_line1, address_line2, city, state_region, postal_code, country,
       goals, modules, referral_source, current_step, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, $9, $10, $11, $12, $13, $14,
       $15::jsonb, $16::jsonb, $17, $18, NOW(), NOW()
     )
     ON CONFLICT (user_id) DO UPDATE SET
       business_name = COALESCE($19::text, user_onboarding.business_name),
       business_type = COALESCE($20::text, user_onboarding.business_type),
       industry = COALESCE($21::text, user_onboarding.industry),
       brand_color = COALESCE($22::text, user_onboarding.brand_color),
       logo_url = COALESCE($23::text, user_onboarding.logo_url),
       team_size = COALESCE($24::text, user_onboarding.team_size),
       website_url = COALESCE($25::text, user_onboarding.website_url),
       address_line1 = COALESCE($26::text, user_onboarding.address_line1),
       address_line2 = COALESCE($27::text, user_onboarding.address_line2),
       city = COALESCE($28::text, user_onboarding.city),
       state_region = COALESCE($29::text, user_onboarding.state_region),
       postal_code = COALESCE($30::text, user_onboarding.postal_code),
       country = COALESCE($31::text, user_onboarding.country),
       goals = COALESCE($32::jsonb, user_onboarding.goals),
       modules = COALESCE($33::jsonb, user_onboarding.modules),
       referral_source = COALESCE($34::text, user_onboarding.referral_source),
       current_step = GREATEST(user_onboarding.current_step, $18),
       updated_at = NOW()`,
    [
      userId,
      cleanText(input.businessName, 160),
      cleanText(input.businessType, 60),
      cleanText(input.industry, 100),
      brandColorValue(input.brandColor),
      brandLogoValue(input.logoUrl),
      cleanText(input.teamSize, 40),
      cleanText(input.websiteUrl, 300),
      cleanText(input.addressLine1, 200),
      cleanText(input.addressLine2, 200),
      cleanText(input.city, 120),
      cleanText(input.stateRegion, 120),
      cleanText(input.postalCode, 40),
      cleanText(input.country, 120),
      JSON.stringify(stringList(input.goals)),
      JSON.stringify(stringList(input.modules)),
      cleanText(input.referralSource, 60),
      step,
      // The COALESCE arguments are null for any key the step did not send,
      // which is what leaves the stored answer untouched.
      has("businessName") ? cleanText(input.businessName, 160) : null,
      has("businessType") ? cleanText(input.businessType, 60) : null,
      has("industry") ? cleanText(input.industry, 100) : null,
      has("brandColor") ? brandColorValue(input.brandColor) : null,
      has("logoUrl") ? brandLogoValue(input.logoUrl) : null,
      has("teamSize") ? cleanText(input.teamSize, 40) : null,
      has("websiteUrl") ? cleanText(input.websiteUrl, 300) : null,
      has("addressLine1") ? cleanText(input.addressLine1, 200) : null,
      has("addressLine2") ? cleanText(input.addressLine2, 200) : null,
      has("city") ? cleanText(input.city, 120) : null,
      has("stateRegion") ? cleanText(input.stateRegion, 120) : null,
      has("postalCode") ? cleanText(input.postalCode, 40) : null,
      has("country") ? cleanText(input.country, 120) : null,
      has("goals") ? JSON.stringify(stringList(input.goals)) : null,
      has("modules") ? JSON.stringify(stringList(input.modules)) : null,
      has("referralSource") ? cleanText(input.referralSource, 60) : null,
    ],
  );
  return getOnboarding(userId);
}

/**
 * Finishes onboarding and seeds what the answers make obvious. The campaign
 * mailing address is written here so the compliance requirement is already
 * satisfied by the time anyone opens Campaigns.
 */
export async function completeOnboarding(
  userId: string,
  input: Record<string, unknown>,
) {
  const state = await saveOnboarding(userId, input);
  if (!state.businessName.trim()) {
    throw new OnboardingError("Tell us what your business is called.");
  }
  // Brand identity is required: the name and colour are what every branded
  // surface — sender identity, public forms, campaign footers — renders from,
  // so finishing without them would leave those looking unconfigured.
  if (!brandColorValue(state.brandColor)) {
    throw new OnboardingError("Choose the colour that represents your brand.");
  }
  const sql = database();
  await sql.query(
    `UPDATE user_onboarding
     SET completed_at = NOW(), skipped_at = NULL, updated_at = NOW()
     WHERE user_id = $1`,
    [userId],
  );

  // company_settings is the workspace's real branding record. Onboarding writes
  // through to it so the answers take effect immediately rather than sitting in
  // a signup table nothing reads. Existing values win: a returning user who
  // already set branding is never overwritten by a late onboarding completion.
  await sql.query(
    `INSERT INTO company_settings (
       user_id, company_name, company_logo_url, company_website, company_size,
       industry, address, address_line1, address_line2, city, state_region,
       postal_code, country, brand_color, created_at, updated_at
     )
     VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''),
             NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''),
             NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''),
             $14, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       company_name = CASE
         WHEN LENGTH(TRIM(COALESCE(company_settings.company_name, ''))) = 0
           THEN EXCLUDED.company_name
         ELSE company_settings.company_name
       END,
       company_logo_url =
         COALESCE(company_settings.company_logo_url, EXCLUDED.company_logo_url),
       company_website =
         COALESCE(company_settings.company_website, EXCLUDED.company_website),
       company_size =
         COALESCE(company_settings.company_size, EXCLUDED.company_size),
       industry = COALESCE(company_settings.industry, EXCLUDED.industry),
       address = COALESCE(company_settings.address, EXCLUDED.address),
       address_line1 = COALESCE(company_settings.address_line1, EXCLUDED.address_line1),
       address_line2 = COALESCE(company_settings.address_line2, EXCLUDED.address_line2),
       city = COALESCE(company_settings.city, EXCLUDED.city),
       state_region = COALESCE(company_settings.state_region, EXCLUDED.state_region),
       postal_code = COALESCE(company_settings.postal_code, EXCLUDED.postal_code),
       country = COALESCE(company_settings.country, EXCLUDED.country),
       brand_color = CASE
         WHEN COALESCE(company_settings.brand_color, '') IN ('', '#236BFE')
           THEN EXCLUDED.brand_color
         ELSE company_settings.brand_color
       END,
       updated_at = NOW()`,
    [
      userId,
      state.businessName.slice(0, 255),
      state.logoUrl,
      state.websiteUrl.slice(0, 255),
      state.teamSize.slice(0, 50),
      (state.industry || state.businessType).slice(0, 100),
      state.mailingAddress.slice(0, 1_000),
      state.addressLine1.slice(0, 200),
      state.addressLine2.slice(0, 200),
      state.city.slice(0, 120),
      state.stateRegion.slice(0, 120),
      state.postalCode.slice(0, 40),
      state.country.slice(0, 120),
      brandColorValue(state.brandColor) || DEFAULT_BRAND_COLOR,
    ],
  );

  if (state.mailingAddress) {
    await sql.query(
      `INSERT INTO contact_campaign_settings (user_id, mailing_address)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         mailing_address = CASE
           WHEN LENGTH(TRIM(contact_campaign_settings.mailing_address)) = 0
             THEN EXCLUDED.mailing_address
           ELSE contact_campaign_settings.mailing_address
         END,
         updated_at = NOW()`,
      [userId, state.mailingAddress],
    );
  }
  return getOnboarding(userId);
}

/** Lets someone get to work now and answer later. */
export async function skipOnboarding(userId: string) {
  await database().query(
    `INSERT INTO user_onboarding (user_id, skipped_at)
     VALUES ($1, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       skipped_at = NOW(), updated_at = NOW()`,
    [userId],
  );
  return getOnboarding(userId);
}

export async function handleOnboardingData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "state";
    const userId = await authenticatedUserId(request);

    if (request.method === "GET" && action === "state") {
      json(response, 200, { result: await getOnboarding(userId) });
      return;
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      const input = (body.input || {}) as Record<string, unknown>;
      if (action === "save") {
        json(response, 200, { result: await saveOnboarding(userId, input) });
        return;
      }
      if (action === "complete") {
        json(response, 200, { result: await completeOnboarding(userId, input) });
        return;
      }
      if (action === "skip") {
        json(response, 200, { result: await skipOnboarding(userId) });
        return;
      }
    }
    json(response, 404, {
      code: "onboarding_action_missing",
      error: "This onboarding action is not available.",
    });
  } catch (error) {
    if (error instanceof OnboardingError) {
      json(response, error.status, { code: error.code, error: error.message });
      return;
    }
    console.error("[onboarding] unexpected request failure", {
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      code: "onboarding_unavailable",
      error: "Account setup could not be saved. Please try again.",
    });
  }
}

import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { hash } from "bcrypt-ts";
import { SignJWT } from "jose";

type JsonValue = Record<string, unknown>;

const databaseUrl =
  process.env.DATABASE_URL || "";
const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
if (!databaseUrl) {
  throw new Error("Payment smoke test requires DATABASE_URL.");
}

const sql = neon(databaseUrl);
const runId = randomUUID().replace(/-/g, "").slice(0, 12);
const secretMarker = `PAYMENT_SMOKE_SECRET_${runId}`;
const ownerId = randomUUID();
const otherUserId = randomUUID();
const formId = randomUUID();
const eventFormId = randomUUID();
const eventId = randomUUID();
const formSubmissionId = randomUUID();
const eventSubmissionId = randomUUID();
const connectionId = randomUUID();
const couponId = randomUUID();
const formAttemptKey = randomUUID();
const eventAttemptKey = randomUUID();
const contactListId = randomUUID();
const raceAttemptKeyA = randomUUID();
const raceAttemptKeyB = randomUUID();
const raceSubmissionIdA = randomUUID();
const raceSubmissionIdB = randomUUID();
const raceCouponId = randomUUID();
const targetedCouponId = randomUUID();
const targetedFormSubmissionIdA = randomUUID();
const targetedFormSubmissionIdB = randomUUID();
const targetedEventSubmissionId = randomUUID();
const targetedFormAttemptKeyA = randomUUID();
const targetedFormAttemptKeyB = randomUUID();
const targetedEventAttemptKey = randomUUID();
const refundFailureOrderId = randomUUID();
const refundFailureKey = randomUUID();
const refundRaceOrderId = randomUUID();
const refundRaceIdA = randomUUID();
const refundRaceIdB = randomUUID();
const refundRaceKeyA = randomUUID();
const refundRaceKeyB = randomUUID();
const slug = `payment-smoke-${runId}`;
const eventSlug = `payment-event-smoke-${runId}`;
const prefix = `S${runId.slice(0, 7).toUpperCase()}-`;
const smokeForwardedAddress =
  `198.51.100.${(Number.parseInt(runId.slice(0, 2), 16) % 250) + 1}`;

let assertions = 0;
let authUserId = "";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  assertions += 1;
};

const request = async (
  path: string,
  input: {
    body?: JsonValue;
    method?: "GET" | "POST";
    token?: string;
  } = {},
) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: input.method || (input.body ? "POST" : "GET"),
    headers: {
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
      ...(input.body ? { "Content-Type": "application/json" } : {}),
      "X-Forwarded-For": smokeForwardedAddress,
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const raw = await response.text();
  let body: JsonValue = {};
  try {
    body = raw ? (JSON.parse(raw) as JsonValue) : {};
  } catch {
    body = {};
  }
  return { body, raw, response };
};

const insertForm = async (input: {
  formId: string;
  payment: JsonValue;
  slug: string;
  title: string;
}) => {
  await sql.query(
    `INSERT INTO forms (
       id, title, description, fields, settings, status, created_by, slug,
       created_at, updated_at
     )
     VALUES ($1, $2, 'Smoke test', '[]'::jsonb, '{}'::jsonb, 'published',
             $3, $4, NOW(), NOW())`,
    [input.formId, input.title, ownerId, input.slug],
  );
  await sql.query(
    `INSERT INTO form_settings (
       form_id, payment, live_snapshot, lifecycle, current_version,
       has_unpublished_changes, created_at, updated_at
     )
     VALUES ($1, $2::jsonb, jsonb_build_object('payment', $2::jsonb),
             'active', 1, FALSE, NOW(), NOW())`,
    [input.formId, JSON.stringify(input.payment)],
  );
  await sql.query(
    `INSERT INTO form_fields (
       form_id, field_id, position, field_type, label, required, width
     )
     VALUES
       ($1, 'full-name', 0, 'shortText', 'Full name', TRUE, 'half'),
       ($1, 'email', 1, 'email', 'Email', TRUE, 'half')`,
    [input.formId],
  );
};

const insertSubmission = async (input: {
  formId: string;
  submissionId: string;
  ticketName?: string;
}) => {
  const data = {
    "full-name": "Payment Smoke Customer",
    email: `customer-${runId}@example.test`,
    ...(input.ticketName ? { "ticket-selection": input.ticketName } : {}),
    _meta: { paymentStatus: "pending", status: "pending_payment" },
  };
  await sql.query(
    `INSERT INTO form_submissions (id, form_id, data, submitted_at)
     VALUES ($1, $2, $3::jsonb, NOW())`,
    [input.submissionId, input.formId, JSON.stringify(data)],
  );
  const answers = [
    ["full-name", data["full-name"]],
    ["email", data.email],
    ...(input.ticketName
      ? ([["ticket-selection", input.ticketName]] as string[][])
      : []),
  ];
  for (const [fieldId, answer] of answers) {
    await sql.query(
      `INSERT INTO form_submission_answers (
         submission_id, field_id, answer, created_at, updated_at
       )
       VALUES ($1, $2, to_jsonb($3::text), NOW(), NOW())`,
      [input.submissionId, fieldId, answer],
    );
  }
};

const checkout = (
  formIdentifier: string,
  submissionId: string,
  idempotencyKey: string,
  couponCode = `FULL${runId}`,
) =>
  request("/api/payments/checkout?action=create", {
    body: {
      amount: 99_999_999,
      couponCode,
      customer: {
        addressLine1: "12 CRM Sync Street",
        addressLine2: "",
        city: "Lagos",
        country: "Nigeria",
        email: `customer-${runId}@example.test`,
        firstName: "Payment Smoke",
        lastName: "Customer",
        phone: "+2348012345678",
        postalCode: "100001",
        region: "Lagos",
      },
      formId: formIdentifier,
      idempotencyKey,
      provider: "paystack",
      submissionId,
    },
  });

const cleanup = async () => {
  await sql.query(`DELETE FROM events WHERE id = $1`, [eventId]);
  await sql.query(`DELETE FROM forms WHERE id IN ($1, $2)`, [
    formId,
    eventFormId,
  ]);
  await sql.query(`DELETE FROM contacts WHERE created_by IN ($1, $2)`, [
    ownerId,
    otherUserId,
  ]);
  await sql.query(`DELETE FROM activity_log WHERE user_id IN ($1, $2)`, [
    ownerId,
    otherUserId,
  ]);
  await sql.query(`DELETE FROM users WHERE id IN ($1, $2)`, [
    ownerId,
    otherUserId,
  ]);
  if (authUserId) {
    await sql.query(`DELETE FROM activity_log WHERE user_id = $1`, [
      authUserId,
    ]);
    await sql.query(`DELETE FROM users WHERE id = $1`, [authUserId]);
  }
};

try {
  const fixturePassword = `Secure-${runId}-Fixture`;
  const fixturePasswordHash = await hash(fixturePassword, 10);
  await sql.query(
    `INSERT INTO users (id, email, password_hash, full_name, short_id)
     VALUES
       ($1, $2, $5, 'Payment Smoke Owner', $6),
       ($3, $4, $5, 'Payment Smoke Other', $7)`,
    [
      ownerId,
      `payment-owner-${runId}@example.test`,
      otherUserId,
      `payment-other-${runId}@example.test`,
      fixturePasswordHash,
      `P${runId.slice(0, 4)}`,
      `Q${runId.slice(4, 8)}`,
    ],
  );

  const ownerLogin = await request("/api/auth?action=sign-in", {
    body: {
      email: `payment-owner-${runId}@example.test`,
      password: fixturePassword,
    },
  });
  const otherLogin = await request("/api/auth?action=sign-in", {
    body: {
      email: `payment-other-${runId}@example.test`,
      password: fixturePassword,
    },
  });
  assert(
    ownerLogin.response.ok && otherLogin.response.ok,
    "Fixture sessions could not be issued.",
  );
  const ownerToken = String(ownerLogin.body.access_token || "");
  const otherToken = String(otherLogin.body.access_token || "");

  const ownerWorkspaceSave = await request(
    "/api/settings?action=workspace",
    {
      body: {
        address: "Owner address",
        brandColor: "#126B5E",
        companyLogoUrl: null,
        companyName: "Owner workspace",
        companySize: "1-10",
        companyWebsite: "",
        industry: "Technology",
        phone: "+2348000000001",
        userId: otherUserId,
      },
      token: ownerToken,
    },
  );
  const otherWorkspaceSave = await request(
    "/api/settings?action=workspace",
    {
      body: {
        address: "Other address",
        brandColor: "#C2415D",
        companyLogoUrl: null,
        companyName: "Other workspace",
        companySize: "1-10",
        companyWebsite: "",
        industry: "Education",
        phone: "+2348000000002",
      },
      token: otherToken,
    },
  );
  assert(
    ownerWorkspaceSave.response.ok && otherWorkspaceSave.response.ok,
    "Isolated workspace settings could not be saved.",
  );
  const ownerRegionalSave = await request(
    "/api/settings?action=regional",
    {
      body: {
        currency: "NGN",
        currencyCountryCode: "NG",
        timezone: "Africa/Lagos",
        userId: otherUserId,
      },
      token: ownerToken,
    },
  );
  const otherRegionalSave = await request(
    "/api/settings?action=regional",
    {
      body: {
        currency: "GBP",
        currencyCountryCode: "GB",
        timezone: "Europe/London",
      },
      token: otherToken,
    },
  );
  assert(
    ownerRegionalSave.response.ok && otherRegionalSave.response.ok,
    "Isolated regional settings could not be saved.",
  );
  const ownerSettings = await request("/api/settings?action=workspace", {
    token: ownerToken,
  });
  const otherSettings = await request("/api/settings?action=workspace", {
    token: otherToken,
  });
  const ownerRegional = await request("/api/settings?action=regional", {
    token: ownerToken,
  });
  const otherRegional = await request("/api/settings?action=regional", {
    token: otherToken,
  });
  assert(
    (ownerSettings.body.workspace as JsonValue | undefined)?.companyName ===
      "Owner workspace" &&
      (otherSettings.body.workspace as JsonValue | undefined)?.companyName ===
        "Other workspace",
    "Workspace identity leaked between users.",
  );
  assert(
    (ownerRegional.body.regional as JsonValue | undefined)?.currency ===
      "NGN" &&
      (otherRegional.body.regional as JsonValue | undefined)?.currency ===
        "GBP",
    "Regional settings leaked between users.",
  );

  const signedUp = await request("/api/auth?action=sign-up", {
    body: {
      country: "Nigeria",
      email: `payment-auth-${runId}@example.test`,
      fullName: "Payment Auth Smoke",
      password: `Secure-${runId}-Pass`,
      phone: "+2348000000000",
    },
  });
  const signedUpUser = signedUp.body.user as JsonValue | undefined;
  authUserId = String(signedUpUser?.id || "");
  assert(
    signedUp.response.status === 201 &&
      Boolean(signedUp.body.access_token) &&
      Boolean(authUserId),
    "Server-side account creation did not issue a secure session.",
  );
  assert(
    !/password|password_hash/i.test(signedUp.raw),
    "Password material leaked from the account endpoint.",
  );
  const signedIn = await request("/api/auth?action=sign-in", {
    body: {
      email: `payment-auth-${runId}@example.test`,
      password: `Secure-${runId}-Pass`,
    },
  });
  assert(
    signedIn.response.ok && Boolean(signedIn.body.access_token),
    "Server-side sign in failed.",
  );
  const accountSession = await request("/api/auth?action=session", {
    token: String(signedIn.body.access_token || ""),
  });
  assert(
    accountSession.response.ok &&
      String((accountSession.body.user as JsonValue | undefined)?.id || "") ===
        authUserId,
    "Server-side session validation failed.",
  );
  const wrongPassword = await request("/api/auth?action=sign-in", {
    body: {
      email: `payment-auth-${runId}@example.test`,
      password: "Definitely-not-the-password",
    },
  });
  assert(
    wrongPassword.response.status === 401 &&
      !/hash|bcrypt|sql|stack/i.test(wrongPassword.raw),
    "Invalid sign in did not fail safely.",
  );

  const browserSecret = process.env.VITE_JWT_SECRET || "";
  if (browserSecret) {
    const browserSignedToken = await new SignJWT({ userId: ownerId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(browserSecret));
    const forgedSession = await request(
      "/api/payments/data?action=workspace",
      { token: browserSignedToken },
    );
    assert(
      forgedSession.response.status === 401,
      "A token signed with the browser-visible legacy key was accepted.",
    );
  }

  await insertForm({
    formId,
    payment: {
      allowCoupons: true,
      amount: 125,
      currency: "NGN",
      enabled: true,
      mode: "fixed",
      provider: "workspace",
    },
    slug,
    title: "Secure payment smoke form",
  });
  await insertSubmission({ formId, submissionId: formSubmissionId });
  await sql.query(
    `WITH saved_list AS (
       INSERT INTO contact_lists (
         id, user_id, name, description, list_type, filter_definition,
         created_by, created_at, updated_at
       )
       VALUES (
         $1, $2, 'Paid form customers', 'Payment CRM smoke list',
         'static', '[]'::jsonb, $2, NOW(), NOW()
       )
       RETURNING id
     )
     INSERT INTO form_list_mappings (
       form_id, list_id, match_mode, field_mapping, created_at, updated_at
     )
     SELECT $3, saved_list.id, 'email',
       '{"email":"email","fullName":"full-name"}'::jsonb, NOW(), NOW()
     FROM saved_list`,
    [contactListId, ownerId, formId],
  );
  const pendingContact = await sql.query(
    `SELECT COUNT(*) AS count
     FROM contacts
     WHERE created_by = $1 AND LOWER(email) = LOWER($2)`,
    [ownerId, `customer-${runId}@example.test`],
  );
  assert(
    Number(pendingContact[0]?.count) === 0,
    "Pending checkout created a CRM customer before payment confirmation.",
  );

  await sql.query(
    `INSERT INTO payment_provider_connections (
       id, user_id, provider, auth_type, status, external_account_id,
       external_account_name, credentials_encrypted, credential_hint,
       is_default, health_ok, connected_at, created_at, updated_at
     )
     VALUES (
       $1, $2, 'paystack', 'api_key', 'connected', $3,
       'Smoke merchant', $3, '...TEST', TRUE, TRUE, NOW(), NOW(), NOW()
     )`,
    [connectionId, ownerId, secretMarker],
  );
  await sql.query(
    `INSERT INTO payment_coupons (
       id, user_id, code, name, discount_type, discount_value, currency,
       redemption_limit, active, applies_to, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'Full smoke discount', 'percentage', 100, NULL,
       2, TRUE, $4::jsonb, NOW(), NOW()
     )`,
    [
      couponId,
      ownerId,
      `FULL${runId}`,
      JSON.stringify([
        { id: formId, type: "form" },
        { id: eventId, type: "event" },
      ]),
    ],
  );

  const unauthenticated = await request(
    "/api/payments/data?action=workspace",
  );
  assert(
    unauthenticated.response.status === 401,
    "Unauthenticated payment data was not rejected.",
  );

  const ownerWorkspace = await request(
    "/api/payments/data?action=workspace",
    { token: ownerToken },
  );
  assert(
    ownerWorkspace.response.ok,
    `Owner payment workspace did not load (${ownerWorkspace.response.status}, ${String(ownerWorkspace.body.code || "unknown")}).`,
  );
  assert(
    !ownerWorkspace.raw.includes(secretMarker),
    "Encrypted credentials leaked into payment workspace response.",
  );
  const ownerData = ownerWorkspace.body.workspace as
    | Record<string, unknown[]>
    | undefined;
  assert(
    ownerData?.couponTargets?.some(
      (target) =>
        (target as JsonValue).id === formId &&
        (target as JsonValue).type === "form",
    ),
    "Paid form was not exposed as an eligible coupon target.",
  );
  for (const forbidden of [
    "credentials_encrypted",
    "provider_subscription_id",
    "provider_refund_id",
    "metadata",
  ]) {
    assert(
      !ownerWorkspace.raw.includes(forbidden),
      `Sensitive field ${forbidden} leaked into workspace response.`,
    );
  }

  const otherWorkspace = await request(
    "/api/payments/data?action=workspace",
    { token: otherToken },
  );
  const otherData = otherWorkspace.body.workspace as
    | Record<string, unknown[]>
    | undefined;
  assert(otherWorkspace.response.ok, "Second payment workspace did not load.");
  assert(
    otherData != null &&
      Object.values(otherData).every(
        (value) => Array.isArray(value) && value.length === 0,
      ),
    "Payment workspace data crossed tenant boundaries.",
  );

  const forgedProduct = await request(
    "/api/payments/data?action=save-product",
    {
      body: {
        active: true,
        billingInterval: null,
        billingType: "one_time",
        currency: "NGN",
        description: "Ownership test",
        imageUrl: "",
        name: "Owned by signed session",
        price: 42.5,
        sku: `SMOKE-${runId}`,
        userId: otherUserId,
      },
      token: ownerToken,
    },
  );
  assert(forgedProduct.response.ok, "Payment product could not be created.");
  const productRows = await sql.query(
    `SELECT user_id FROM payment_products
     WHERE UPPER(sku) = UPPER($1)`,
    [`SMOKE-${runId}`],
  );
  assert(
    String(productRows[0]?.user_id) === ownerId,
    "Payment mutation trusted a forged browser user ID.",
  );

  const invalidProduct = await request(
    "/api/payments/data?action=save-product",
    {
      body: {
        active: true,
        billingType: "one_time",
        currency: "NOT_A_CURRENCY",
        imageUrl: "",
        name: "Invalid",
        price: -1,
        sku: "INVALID",
      },
      token: ownerToken,
    },
  );
  assert(
    invalidProduct.response.status === 400,
    "Invalid payment input was not rejected.",
  );
  assert(
    !/sql|postgres|database_url|stack|constraint/i.test(invalidProduct.raw),
    "Internal database detail leaked in validation response.",
  );

  const crossTenantSync = await request(
    "/api/payments/data?action=sync-form-product",
    {
      body: { formId },
      token: otherToken,
    },
  );
  assert(
    crossTenantSync.response.status === 404,
    "Cross-tenant form product sync was not rejected.",
  );

  const synced = await request(
    "/api/payments/data?action=sync-form-product",
    {
      body: { formId, price: 0, userId: otherUserId },
      token: ownerToken,
    },
  );
  assert(synced.response.ok, "Form payment product did not sync.");
  const syncedRows = await sql.query(
    `SELECT price, currency, user_id
     FROM payment_products
     WHERE source_type = 'form' AND source_id = $1`,
    [formId],
  );
  assert(
    Number(syncedRows[0]?.price) === 125 &&
      syncedRows[0]?.currency === "NGN" &&
      syncedRows[0]?.user_id === ownerId,
    "Form product did not use the database form settings as source of truth.",
  );

  const formCheckout = await checkout(
    slug,
    formSubmissionId,
    formAttemptKey,
  );
  assert(
    formCheckout.response.ok &&
      formCheckout.body.status === "confirmed" &&
      formCheckout.body.free === true,
    `Form coupon checkout did not complete (${formCheckout.response.status}, ${String(formCheckout.body.code || "unknown")}, ${String(formCheckout.body.error || formCheckout.raw || "no detail")}).`,
  );
  const repeatedFormCheckout = await checkout(
    slug,
    formSubmissionId,
    formAttemptKey,
  );
  assert(
    repeatedFormCheckout.response.ok &&
      repeatedFormCheckout.body.status === "confirmed",
    "Form checkout idempotency replay failed.",
  );
  const formCommerce = await sql.query(
    `SELECT
       (SELECT COUNT(*) FROM payment_orders
        WHERE source_type = 'form' AND source_id = $1) AS orders,
       (SELECT COUNT(*) FROM checkout_attempts
        WHERE idempotency_key = $2) AS attempts,
       (SELECT COUNT(*) FROM payments payment
        JOIN form_submissions submission ON submission.id = payment.submission_id
        WHERE submission.form_id = $1) AS payments,
       (SELECT COUNT(*) FROM payment_invoices invoice
        JOIN payment_orders payment_order ON payment_order.id = invoice.order_id
        WHERE payment_order.source_type = 'form'
          AND payment_order.source_id = $1) AS invoices,
       (SELECT total_amount FROM payment_orders
        WHERE source_type = 'form' AND source_id = $1 LIMIT 1) AS total`,
    [formId, formAttemptKey],
  );
  assert(
    Number(formCommerce[0]?.orders) === 1 &&
      Number(formCommerce[0]?.attempts) === 1 &&
      Number(formCommerce[0]?.payments) === 1 &&
      Number(formCommerce[0]?.invoices) === 1 &&
      Number(formCommerce[0]?.total) === 0,
    "Form checkout did not create one canonical commerce record set.",
  );
  const formCrmSync = await sql.query(
    `SELECT payment_order.id AS order_id, payment_order.contact_id,
            contact.full_name, contact.email, contact.phone,
            contact.lifecycle_stage,
            (SELECT COUNT(*)
             FROM contact_activity activity
             WHERE activity.user_id = $1
               AND activity.entity_type = 'payment_order'
               AND activity.entity_id = payment_order.id
               AND activity.activity_type = 'payment_confirmed')
              AS payment_activities,
            (SELECT COUNT(*)
             FROM contact_list_members member
             WHERE member.list_id = $2
               AND member.contact_id = payment_order.contact_id)
              AS list_memberships
     FROM payment_orders payment_order
     JOIN contacts contact ON contact.id = payment_order.contact_id
     WHERE payment_order.user_id = $1
       AND payment_order.source_type = 'form'
       AND payment_order.source_id = $3
     LIMIT 1`,
    [ownerId, contactListId, formId],
  );
  assert(
    formCrmSync.length === 1 &&
      formCrmSync[0]?.contact_id &&
      formCrmSync[0]?.full_name === "Payment Smoke Customer" &&
      formCrmSync[0]?.email === `customer-${runId}@example.test` &&
      formCrmSync[0]?.phone === "+2348012345678" &&
      formCrmSync[0]?.lifecycle_stage === "customer",
    "Confirmed payment did not create and link the CRM customer correctly.",
  );
  assert(
    Number(formCrmSync[0]?.payment_activities) === 1 &&
      Number(formCrmSync[0]?.list_memberships) === 1,
    "Confirmed payment did not create one CRM timeline event and mapped-list membership.",
  );

  const paymentWorkspaceAfterSync = await request(
    "/api/payments/data?action=workspace",
    { token: ownerToken },
  );
  const syncedPaymentWorkspace = paymentWorkspaceAfterSync.body.workspace as
    | Record<string, unknown[]>
    | undefined;
  assert(
    paymentWorkspaceAfterSync.response.ok &&
      syncedPaymentWorkspace?.orders?.some(
        (order) =>
          (order as JsonValue).id === formCrmSync[0]?.order_id &&
          (order as JsonValue).contact_id === formCrmSync[0]?.contact_id,
      ),
    "Payments workspace did not expose its linked CRM contact.",
  );
  assert(
    !paymentWorkspaceAfterSync.raw.includes("provider_reference"),
    "Payments workspace leaked a provider transaction reference field.",
  );
  const crmWorkspaceAfterPayment = await request(
    "/api/crm/data?action=workspace",
    { body: {}, token: ownerToken },
  );
  const crmPaymentData = crmWorkspaceAfterPayment.body.result as
    | Record<string, unknown[]>
    | undefined;
  assert(
    crmWorkspaceAfterPayment.response.ok &&
      crmPaymentData?.contacts?.some(
        (contact) =>
          (contact as JsonValue).id === formCrmSync[0]?.contact_id &&
          (contact as JsonValue).lifecycleStage === "customer",
      ) &&
      crmPaymentData?.activities?.some(
        (activity) =>
          (activity as JsonValue).activityType === "payment_confirmed" &&
          (activity as JsonValue).contactId === formCrmSync[0]?.contact_id,
      ),
    "CRM workspace did not surface the confirmed payment customer and activity.",
  );
  assert(
    crmPaymentData?.revenue?.some(
      (point) =>
        Number((point as JsonValue).orders) === 1 &&
        Number((point as JsonValue).revenue) === 0,
    ),
    "CRM revenue reporting did not include the confirmed zero-total order.",
  );
  const otherCrmWorkspace = await request(
    "/api/crm/data?action=workspace",
    { body: {}, token: otherToken },
  );
  const otherCrmData = otherCrmWorkspace.body.result as
    | Record<string, unknown[]>
    | undefined;
  assert(
    otherCrmWorkspace.response.ok &&
      !otherCrmData?.contacts?.some(
        (contact) =>
          (contact as JsonValue).email ===
          `customer-${runId}@example.test`,
      ) &&
      !otherCrmData?.activities?.some(
        (activity) =>
          (activity as JsonValue).activityType === "payment_confirmed",
      ),
    "Payment CRM synchronization crossed workspace ownership.",
  );

  await insertForm({
    formId: eventFormId,
    payment: {
      allowCoupons: false,
      amount: 0,
      currency: "NGN",
      enabled: true,
      mode: "product",
      provider: "workspace",
    },
    slug: eventSlug,
    title: "Secure event registration",
  });
  await sql.query(
    `INSERT INTO form_fields (
       form_id, field_id, position, field_type, label, required, width
     )
     VALUES ($1, 'ticket-selection', 0, 'dropdown', 'Choose your ticket',
             TRUE, 'full')`,
    [eventFormId],
  );
  await sql.query(
    `INSERT INTO events (
       id, created_by, registration_form_id, title, slug, description, status,
       location_type, address, starts_at, ends_at, timezone,
       ticketing_enabled, ticket_prefix, ticket_prefix_configured,
       created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'Secure payment smoke event', $4, 'Smoke event',
       'on_sale', 'physical', 'Smoke venue', NOW() + INTERVAL '7 days',
       NOW() + INTERVAL '7 days 3 hours', 'Africa/Lagos', TRUE, $5, TRUE,
       NOW(), NOW()
     )`,
    [eventId, ownerId, eventFormId, `event-${eventSlug}`, prefix],
  );
  await sql.query(
    `INSERT INTO event_pricing (
       event_id, enabled, amount, currency, label, tax_included,
       discounts_enabled, coupons_enabled, created_at, updated_at
     )
     VALUES (
       $1, FALSE, 0, 'NGN', 'Ticket price', FALSE, FALSE, TRUE, NOW(), NOW()
     )`,
    [eventId],
  );
  await sql.query(
    `INSERT INTO event_ticket_types (
       event_id, name, description, price, currency, quantity_available,
       min_per_order, max_per_order, active, sort_order
     )
     VALUES (
       $1, 'Smoke admission', 'Isolated test ticket', 200, 'NGN', 20,
       1, 4, TRUE, 0
     )`,
    [eventId],
  );
  await insertSubmission({
    formId: eventFormId,
    submissionId: eventSubmissionId,
    ticketName: "Smoke admission",
  });

  const eventCheckoutOptions = await request(
    `/api/payments/checkout?action=options&form=${eventSlug}`,
  );
  assert(
    eventCheckoutOptions.response.ok &&
      eventCheckoutOptions.body.allowCoupons === true &&
      (eventCheckoutOptions.body.workspace as JsonValue | undefined)?.name ===
        "Owner workspace" &&
      (eventCheckoutOptions.body.workspace as JsonValue | undefined)
        ?.accentColor === "#126B5E",
    "Targeted event checkout did not expose its safe workspace branding.",
  );

  const eventCheckout = await checkout(
    eventSlug,
    eventSubmissionId,
    eventAttemptKey,
  );
  assert(
    eventCheckout.response.ok &&
      eventCheckout.body.status === "confirmed" &&
      eventCheckout.body.free === true,
    `Event ticket checkout did not complete (${eventCheckout.response.status}, ${String(eventCheckout.body.code || "unknown")}).`,
  );
  const repeatedEventCheckout = await checkout(
    eventSlug,
    eventSubmissionId,
    eventAttemptKey,
  );
  assert(
    repeatedEventCheckout.response.ok &&
      repeatedEventCheckout.body.status === "confirmed",
    "Event checkout idempotency replay failed.",
  );
  const sharedCustomerSync = await sql.query(
    `SELECT
       (SELECT COUNT(*) FROM contacts
        WHERE created_by = $1 AND LOWER(email) = LOWER($2)) AS contacts,
       (SELECT COUNT(*) FROM contact_activity activity
        JOIN contacts contact ON contact.id = activity.contact_id
        WHERE activity.user_id = $1
          AND LOWER(contact.email) = LOWER($2)
          AND activity.activity_type = 'payment_confirmed') AS activities,
       (SELECT COUNT(DISTINCT payment_order.contact_id)
        FROM payment_orders payment_order
        WHERE payment_order.user_id = $1
          AND payment_order.source_id IN ($3, $4)
          AND payment_order.status = 'paid') AS linked_contacts`,
    [
      ownerId,
      `customer-${runId}@example.test`,
      formId,
      eventId,
    ],
  );
  assert(
    Number(sharedCustomerSync[0]?.contacts) === 1 &&
      Number(sharedCustomerSync[0]?.activities) === 2 &&
      Number(sharedCustomerSync[0]?.linked_contacts) === 1,
    "Form and event payments did not deduplicate to one CRM customer with one activity per order.",
  );

  const ticketRows = await sql.query(
    `SELECT attendee.ticket_number, attendee.ticket_code,
            event_order.status AS order_status
     FROM event_attendees attendee
     JOIN event_orders event_order ON event_order.id = attendee.order_id
     WHERE attendee.registration_submission_id = $1`,
    [eventSubmissionId],
  );
  assert(ticketRows.length === 1, "Event attendee ticket was not issued.");
  assert(
    String(ticketRows[0]?.ticket_number || "").startsWith(prefix) &&
      String(ticketRows[0]?.ticket_code || "").startsWith("mfe1.") &&
      ticketRows[0]?.order_status === "paid",
    "Event ticket identity was not issued and persisted correctly.",
  );

  const status = await request(
    `/api/payments/checkout?action=status&key=${eventAttemptKey}`,
  );
  const statusOrder = status.body.order as JsonValue | undefined;
  const statusTicket = statusOrder?.ticket as JsonValue | undefined;
  assert(
    status.response.ok &&
      status.body.status === "confirmed" &&
      String(statusTicket?.number || "").startsWith(prefix),
    "Public payment verification did not return the paid event ticket.",
  );
  assert(
    !status.raw.includes(secretMarker) &&
      !/credentials_encrypted|provider_reference/i.test(status.raw),
    "Sensitive payment data leaked into the public verification response.",
  );

  const couponRows = await sql.query(
    `SELECT redemption_count FROM payment_coupons WHERE id = $1`,
    [couponId],
  );
  assert(
    Number(couponRows[0]?.redemption_count) === 2,
    "Coupon redemption was not idempotent across form and event checkouts.",
  );

  const targetedCoupon = await request(
    "/api/payments/data?action=save-coupon",
    {
      body: {
        active: true,
        appliesTo: [{ id: formId, type: "form" }],
        code: `ONE${runId}`,
        currency: null,
        discountType: "percentage",
        discountValue: 100,
        endsAt: "",
        id: targetedCouponId,
        maximumDiscount: null,
        minimumAmount: 0,
        name: "One use per customer",
        redemptionLimit: 10,
        redemptionLimitPerCustomer: 1,
        startsAt: "",
      },
      token: ownerToken,
    },
  );
  assert(
    targetedCoupon.response.status === 404,
    "Client-supplied coupon IDs should not create records.",
  );
  const createdTargetedCoupon = await request(
    "/api/payments/data?action=save-coupon",
    {
      body: {
        active: true,
        appliesTo: [{ id: formId, type: "form" }],
        code: `ONE${runId}`,
        currency: null,
        discountType: "percentage",
        discountValue: 100,
        endsAt: "",
        maximumDiscount: null,
        minimumAmount: 0,
        name: "One use per customer",
        redemptionLimit: 10,
        redemptionLimitPerCustomer: 1,
        startsAt: "",
      },
      token: ownerToken,
    },
  );
  assert(
    createdTargetedCoupon.response.ok,
    "Targeted coupon could not be created.",
  );
  const createdCouponRow = createdTargetedCoupon.body.row as
    | JsonValue
    | undefined;
  const createdCouponId = String(createdCouponRow?.id || "");
  assert(
    Number(createdCouponRow?.redemption_limit_per_customer) === 1 &&
      Array.isArray(createdCouponRow?.applies_to) &&
      (createdCouponRow.applies_to as JsonValue[])[0]?.id === formId,
    "Coupon target and per-customer limit were not persisted.",
  );

  await insertSubmission({
    formId,
    submissionId: targetedFormSubmissionIdA,
  });
  await insertSubmission({
    formId,
    submissionId: targetedFormSubmissionIdB,
  });
  await insertSubmission({
    formId: eventFormId,
    submissionId: targetedEventSubmissionId,
    ticketName: "Smoke admission",
  });
  const targetedCode = `ONE${runId}`;
  const firstCustomerUse = await checkout(
    slug,
    targetedFormSubmissionIdA,
    targetedFormAttemptKeyA,
    targetedCode,
  );
  const repeatedCustomerUse = await checkout(
    slug,
    targetedFormSubmissionIdB,
    targetedFormAttemptKeyB,
    targetedCode,
  );
  const wrongTargetUse = await checkout(
    eventSlug,
    targetedEventSubmissionId,
    targetedEventAttemptKey,
    targetedCode,
  );
  assert(
    firstCustomerUse.response.ok &&
      firstCustomerUse.body.status === "confirmed",
    "Selected form coupon did not complete its eligible checkout.",
  );
  assert(
    repeatedCustomerUse.response.status === 422,
    "Per-customer coupon limit did not reject a repeated customer.",
  );
  assert(
    wrongTargetUse.response.status === 422,
    "Form-only coupon was accepted by an event checkout.",
  );
  const targetedRedemptions = await sql.query(
    `SELECT redemption_count
     FROM payment_coupons
     WHERE id = $1`,
    [createdCouponId],
  );
  assert(
    Number(targetedRedemptions[0]?.redemption_count) === 1,
    "Targeted coupon redemption count was not preserved.",
  );

  await insertSubmission({
    formId,
    submissionId: raceSubmissionIdA,
  });
  await insertSubmission({
    formId,
    submissionId: raceSubmissionIdB,
  });
  await sql.query(
    `INSERT INTO payment_coupons (
       id, user_id, code, name, discount_type, discount_value,
       redemption_limit, active, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'Concurrent smoke discount', 'percentage', 100,
       1, TRUE, NOW(), NOW()
     )`,
    [raceCouponId, ownerId, `RACE${runId}`],
  );
  const raceResults = await Promise.all([
    checkout(
      slug,
      raceSubmissionIdA,
      raceAttemptKeyA,
      `RACE${runId}`,
    ),
    checkout(
      slug,
      raceSubmissionIdB,
      raceAttemptKeyB,
      `RACE${runId}`,
    ),
  ]);
  assert(
    raceResults.filter((result) => result.response.ok).length === 1 &&
      raceResults.filter((result) => result.response.status === 422).length ===
        1,
    "Concurrent limited coupon checkouts were not serialized.",
  );
  const raceRows = await sql.query(
    `SELECT coupon.redemption_count,
            COUNT(redemption.order_id) FILTER (
              WHERE redemption.status = 'redeemed'
            ) AS redeemed_orders
     FROM payment_coupons coupon
     LEFT JOIN payment_coupon_redemptions redemption
       ON redemption.coupon_id = coupon.id
     WHERE coupon.id = $1
     GROUP BY coupon.id`,
    [raceCouponId],
  );
  assert(
    Number(raceRows[0]?.redemption_count) === 1 &&
      Number(raceRows[0]?.redeemed_orders) === 1,
    "Limited coupon was redeemed more than once.",
  );

  const invoiceEmail = `invoice-customer-${runId}@example.test`;
  const savedInvoice = await request(
    "/api/payments/data?action=save-invoice",
    {
      body: {
        amountDue: 45,
        currency: "NGN",
        customerEmail: invoiceEmail,
        customerName: "Invoice CRM Customer",
        dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        lineItems: [
          {
            id: randomUUID(),
            name: "CRM synchronization service",
            quantity: 1,
            unitPrice: 45,
          },
        ],
        memo: "Payment CRM synchronization smoke invoice",
      },
      token: ownerToken,
    },
  );
  const invoiceRow = savedInvoice.body.row as JsonValue | undefined;
  const invoiceId = String(invoiceRow?.id || "");
  assert(
    savedInvoice.response.ok && Boolean(invoiceId),
    "Manual invoice could not be created.",
  );
  const crossTenantInvoicePayment = await request(
    "/api/payments/data?action=update-invoice",
    {
      body: { id: invoiceId, status: "paid" },
      token: otherToken,
    },
  );
  assert(
    crossTenantInvoicePayment.response.status === 404,
    "Another workspace could mark an invoice as paid.",
  );
  const paidInvoice = await request(
    "/api/payments/data?action=update-invoice",
    {
      body: { id: invoiceId, status: "paid" },
      token: ownerToken,
    },
  );
  const paidInvoiceRow = paidInvoice.body.row as JsonValue | undefined;
  const invoiceOrderId = String(paidInvoiceRow?.order_id || "");
  assert(
    paidInvoice.response.ok &&
      paidInvoiceRow?.status === "paid" &&
      Boolean(invoiceOrderId),
    "Paid invoice did not create its canonical payment order.",
  );
  const replayedPaidInvoice = await request(
    "/api/payments/data?action=update-invoice",
    {
      body: { id: invoiceId, status: "paid" },
      token: ownerToken,
    },
  );
  assert(
    replayedPaidInvoice.response.ok &&
      (replayedPaidInvoice.body.row as JsonValue | undefined)?.order_id ===
        invoiceOrderId,
    "Paid invoice replay changed its canonical order.",
  );
  const invoiceCrmSync = await sql.query(
    `SELECT payment_order.contact_id, payment_order.total_amount,
            payment_order.status, contact.lifecycle_stage,
            (SELECT COUNT(*) FROM payment_orders
             WHERE user_id = $1 AND source_type = 'invoice'
               AND source_id = $2) AS orders,
            (SELECT COUNT(*) FROM payment_order_items
             WHERE order_id = payment_order.id) AS items,
            (SELECT COUNT(*) FROM contact_activity
             WHERE user_id = $1 AND entity_type = 'payment_order'
               AND entity_id = payment_order.id) AS activities
     FROM payment_orders payment_order
     JOIN contacts contact ON contact.id = payment_order.contact_id
     WHERE payment_order.id = $3 AND payment_order.user_id = $1`,
    [ownerId, invoiceId, invoiceOrderId],
  );
  assert(
    invoiceCrmSync.length === 1 &&
      invoiceCrmSync[0]?.status === "paid" &&
      Number(invoiceCrmSync[0]?.total_amount) === 45 &&
      invoiceCrmSync[0]?.lifecycle_stage === "customer" &&
      Number(invoiceCrmSync[0]?.orders) === 1 &&
      Number(invoiceCrmSync[0]?.items) === 1 &&
      Number(invoiceCrmSync[0]?.activities) === 1,
    "Paid invoice did not synchronize one order, contact, item, and CRM activity.",
  );
  const contactPayments = await request(
    "/api/contacts/data?action=list-contact-payments",
    {
      body: { contactEmail: invoiceEmail },
      token: ownerToken,
    },
  );
  const contactPaymentRows = contactPayments.body.result as
    | JsonValue[]
    | undefined;
  assert(
    contactPayments.response.ok &&
      contactPaymentRows?.some(
        (payment) =>
          payment.id === invoiceOrderId &&
          payment.amount === 45 &&
          payment.status === "paid",
      ),
    "CRM contact payment history did not show the paid invoice order.",
  );
  const crmAfterInvoice = await request(
    "/api/crm/data?action=workspace",
    { body: {}, token: ownerToken },
  );
  const crmInvoiceData = crmAfterInvoice.body.result as
    | Record<string, unknown[]>
    | undefined;
  assert(
    crmAfterInvoice.response.ok &&
      crmInvoiceData?.contacts?.some(
        (contact) =>
          (contact as JsonValue).id === invoiceCrmSync[0]?.contact_id,
      ) &&
      crmInvoiceData?.revenue?.some(
        (point) =>
          Number((point as JsonValue).revenue) === 45 &&
          Number((point as JsonValue).orders) >= 5,
      ),
    "Paid invoice did not reach CRM contacts and revenue reporting.",
  );

  await sql.query(
    `INSERT INTO payment_orders (
       id, user_id, order_number, source_type, contact_id, customer_name,
       customer_email, status, provider, provider_reference, subtotal,
       total_amount, currency, paid_at, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'manual', $4, 'Refund smoke customer',
       'refund-smoke@example.test', 'paid', 'paystack',
       'provider-reference-smoke', 100, 100, 'NGN', NOW(), NOW(), NOW()
     )`,
    [
      refundFailureOrderId,
      ownerId,
      `RF-FAIL-${runId}`,
      invoiceCrmSync[0]?.contact_id,
    ],
  );
  const failedRefund = await request(
    "/api/payments/providers?action=refund",
    {
      body: {
        amount: 40,
        idempotencyKey: refundFailureKey,
        orderId: refundFailureOrderId,
        reason: "Smoke provider rejection",
      },
      token: ownerToken,
    },
  );
  assert(
    failedRefund.response.status === 409 &&
      !/sql|postgres|credentials_encrypted|stack/i.test(failedRefund.raw),
    "Refund provider failure was not returned safely.",
  );
  const failedRefundRows = await sql.query(
    `SELECT payment_order.refunded_amount, refund.status,
            (SELECT COUNT(*) FROM contact_activity activity
             WHERE activity.id = refund.id
               AND activity.contact_id = payment_order.contact_id
               AND activity.activity_type = 'payment_refund')
              AS crm_activities
     FROM payment_orders payment_order
     JOIN payment_refunds refund ON refund.order_id = payment_order.id
     WHERE payment_order.id = $1`,
    [refundFailureOrderId],
  );
  assert(
    Number(failedRefundRows[0]?.refunded_amount) === 0 &&
      failedRefundRows[0]?.status === "failed" &&
      Number(failedRefundRows[0]?.crm_activities) === 1,
    "Rejected refund did not release the balance and synchronize its CRM activity.",
  );
  const replayedFailedRefund = await request(
    "/api/payments/providers?action=refund",
    {
      body: {
        amount: 40,
        idempotencyKey: refundFailureKey,
        orderId: refundFailureOrderId,
        reason: "Smoke provider rejection",
      },
      token: ownerToken,
    },
  );
  assert(
    replayedFailedRefund.response.ok &&
      (replayedFailedRefund.body.refund as JsonValue | undefined)?.status ===
        "failed" &&
      Number(
        (
          await sql.query(
            `SELECT COUNT(*) AS count
             FROM contact_activity
             WHERE id = (
               SELECT id FROM payment_refunds WHERE order_id = $1 LIMIT 1
             )`,
            [refundFailureOrderId],
          )
        )[0]?.count,
      ) === 1,
    "Refund idempotency replay did not return the original result.",
  );

  await sql.query(
    `INSERT INTO payment_orders (
       id, user_id, order_number, source_type, customer_name, customer_email,
       status, provider, provider_reference, subtotal, total_amount, currency,
       paid_at, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'manual', 'Concurrent refund customer',
       'refund-race@example.test', 'paid', 'paystack',
       'provider-reference-race', 100, 100, 'NGN', NOW(), NOW(), NOW()
     )`,
    [refundRaceOrderId, ownerId, `RF-RACE-${runId}`],
  );
  const refundReservations = await Promise.all([
    sql.query(
      `SELECT maxform_reserve_payment_refund(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, 80, 'Race A'
       ) AS reserved`,
      [ownerId, refundRaceOrderId, refundRaceIdA, refundRaceKeyA],
    ),
    sql.query(
      `SELECT maxform_reserve_payment_refund(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, 80, 'Race B'
       ) AS reserved`,
      [ownerId, refundRaceOrderId, refundRaceIdB, refundRaceKeyB],
    ),
  ]);
  assert(
    refundReservations.filter((rows) => rows[0]?.reserved === true).length ===
      1,
    "Concurrent refunds reserved more than the available order balance.",
  );
  const refundRaceRows = await sql.query(
    `SELECT refunded_amount,
            (SELECT COUNT(*) FROM payment_refunds
             WHERE order_id = $1 AND status = 'pending') AS pending_refunds
     FROM payment_orders
     WHERE id = $1`,
    [refundRaceOrderId],
  );
  assert(
    Number(refundRaceRows[0]?.refunded_amount) === 80 &&
      Number(refundRaceRows[0]?.pending_refunds) === 1,
    "Concurrent refund reservation did not preserve the order balance.",
  );
  const netAnalytics = await request(
    "/api/analytics/data?range=30",
    { token: ownerToken },
  );
  const netSummary = netAnalytics.body.summary as JsonValue | undefined;
  assert(
    netAnalytics.response.ok &&
      Number(netSummary?.paid_orders) === 7 &&
      Number(netSummary?.paid_revenue) === 165,
    "Payments analytics did not report refunded orders at their net revenue.",
  );
  const crmAfterRefund = await request(
    "/api/crm/data?action=workspace",
    { body: {}, token: ownerToken },
  );
  const crmRefundData = crmAfterRefund.body.result as
    | Record<string, unknown[]>
    | undefined;
  assert(
    crmAfterRefund.response.ok &&
      crmRefundData?.activities?.some(
        (activity) =>
          (activity as JsonValue).activityType === "payment_refund" &&
          (activity as JsonValue).contactId ===
            invoiceCrmSync[0]?.contact_id,
      ) &&
      crmRefundData?.revenue?.some(
        (point) =>
          Number((point as JsonValue).orders) === 7 &&
          Number((point as JsonValue).revenue) === 165,
      ),
    "CRM did not surface refund activity and net payment revenue.",
  );

  process.stdout.write(
    `Payment smoke test passed (${assertions} assertions).\n`,
  );
} finally {
  await cleanup();
}

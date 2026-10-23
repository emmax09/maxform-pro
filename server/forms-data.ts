import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify, SignJWT } from "jose";

import {
  configureFormsServerDependencies,
  createFormWorkflow,
  createWorkspaceForm,
  deleteAutomationConnection,
  deleteFormSubmissions,
  deleteFormWorkflow,
  deleteWorkspaceForm,
  duplicateFormWorkflow,
  getPublicForm,
  isFormSlugAvailable,
  listAutomationConnections,
  listAutomationProviders,
  listAutomationRuns,
  listFormSubmissions,
  listFormWorkflows,
  saveAutomationConnection,
  saveWorkspaceForm,
  setFormWorkflowEnabled,
  submitPreparedPublicForm,
  testAutomationConnection,
  updateFormSubmission,
  updateFormWorkflow,
} from "../src/lib/forms";
import { cacheDelete, cacheKey, cached } from "./cache";
import { consumeRateLimit } from "./rate-limit";
import { resolveOwnedProjectId } from "./projects-data";
import {
  addContactsToList,
  createContact,
  syncSubmissionContact,
  updateContact,
} from "./contacts-data";
import { sendFormAutomationEmailNow } from "./email-automation";
import { sendEventRegistrationEmailNow } from "./event-mail";
import {
  executeFormAutomationProviderAction,
  getAutomationOAuthProviderStatusServer,
} from "./integration-oauth";
import { getCustomWebhookConfig } from "./integrations-data";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";
import {
  hasConnectedPaymentProviderServer,
  listPaymentProductsServer,
  listSecureFormPaymentsServer,
} from "./payment-data";
import {
  deleteStoredObjectServer,
  getStoredObjectAccessBatchServer,
} from "./storage-api";
import { workspaceScopeFor } from "./workspace-access";
import {
  LEGACY_FORM_ACCENTS,
  inferAccentColorMode,
  resolveAccentColor,
  workspaceAccentColor,
} from "../src/lib/workspace-branding";

type RecordValue = Record<string, unknown>;

const valueText = (value: unknown) =>
  typeof value === "string" ? value : value == null ? "" : String(value);
const valueNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const valueBoolean = (value: unknown) =>
  value === true || value === "true" || value === 1;
const valueJson = <T,>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return typeof value === "object" ? (value as T) : fallback;
};

const requestClientIdentifier = (request: IncomingMessage) => {
  const forwarded = valueText(request.headers["x-forwarded-for"])
    .split(",")[0]
    .trim();
  return forwarded || request.socket.remoteAddress || "unknown";
};

export const configureFormsDataRuntime = () => {
  configureFormsServerDependencies({
    addContactsToList,
    createContact,
    deleteStoredObject: deleteStoredObjectServer,
    executeOAuthAction: executeFormAutomationProviderAction,
    getWebhookConfig: getCustomWebhookConfig,
    getOAuthProviderStatus: async () =>
      getAutomationOAuthProviderStatusServer(),
    getStoredObjectAccessBatch: async (
      userId: string,
      objectIds: string[],
    ) =>
      getStoredObjectAccessBatchServer(userId, objectIds) as never,
    hasConnectedPaymentProvider: hasConnectedPaymentProviderServer,
    listPaymentProducts: async (userId: string) => {
      const rows = await listPaymentProductsServer(userId);
      return rows.map((row) => {
        const item = row as RecordValue;
        return {
          id: valueText(item.id),
          name: valueText(item.name),
          description: valueText(item.description),
          shortDescription: valueText(item.short_description),
          sku: valueText(item.sku),
          price: valueNumber(item.price),
          salePrice: item.sale_price == null ? null : valueNumber(item.sale_price),
          currency: valueText(item.currency),
          billingType:
            valueText(item.billing_type) === "recurring"
              ? ("recurring" as const)
              : ("one_time" as const),
          billingInterval: valueText(item.billing_interval) || null,
          sourceType: valueText(item.source_type),
          sourceId: valueText(item.source_id) || null,
          imageUrl: valueText(item.image_url),
          imageGallery: valueJson<string[]>(item.image_gallery, []),
          promotionalBanner: valueText(item.promotional_banner),
          category: valueText(item.category),
          status: (valueText(item.product_status) || "active") as
            | "active"
            | "draft"
            | "hidden"
            | "sold_out",
          availabilityStartAt: valueText(item.availability_start_at),
          availabilityEndAt: valueText(item.availability_end_at),
          minQuantity:
            item.min_quantity == null ? 1 : valueNumber(item.min_quantity),
          maxQuantity:
            item.max_quantity == null ? 1000 : valueNumber(item.max_quantity),
          onePerCustomer: valueBoolean(item.one_per_customer),
          hideWhenSoldOut: valueBoolean(item.hide_when_sold_out),
          taxable: valueBoolean(item.taxable),
          taxRate: valueNumber(item.tax_rate),
          requiresShipping: valueBoolean(item.requires_shipping),
          trackInventory: valueBoolean(item.track_inventory),
          inventoryQuantity: valueNumber(item.inventory_quantity),
          lowStockThreshold: valueNumber(item.low_stock_threshold),
          allowBackorder: valueBoolean(item.allow_backorder),
          weightGrams: valueNumber(item.weight_grams),
          options: valueJson<string[]>(item.options, []),
          variants: valueJson<RecordValue[]>(item.variants, []).map((variant) => ({
            id: valueText(variant.id),
            name: valueText(variant.name),
            sku: valueText(variant.sku),
            price: valueNumber(variant.price),
            salePrice:
              variant.sale_price == null && variant.salePrice == null
                ? null
                : valueNumber(variant.salePrice ?? variant.sale_price),
            description: valueText(variant.description),
            optionValues: valueJson<Record<string, string>>(
              variant.optionValues ?? variant.option_values,
              {},
            ),
            imageUrl: valueText(variant.imageUrl ?? variant.image_url),
            trackInventory: valueBoolean(
              variant.trackInventory ?? variant.track_inventory,
            ),
            inventoryQuantity: valueNumber(
              variant.inventoryQuantity ?? variant.inventory_quantity,
            ),
            lowStockThreshold: valueNumber(
              variant.lowStockThreshold ?? variant.low_stock_threshold,
            ),
            allowBackorder: valueBoolean(
              variant.allowBackorder ?? variant.allow_backorder,
            ),
            weightGrams: valueNumber(variant.weightGrams ?? variant.weight_grams),
            availabilityStartAt: valueText(
              variant.availabilityStartAt ?? variant.availability_start_at,
            ),
            availabilityEndAt: valueText(
              variant.availabilityEndAt ?? variant.availability_end_at,
            ),
            active: valueBoolean(variant.active),
            sortOrder: valueNumber(variant.sortOrder ?? variant.sort_order),
          })),
          active: valueBoolean(item.active),
          createdAt: valueText(item.created_at),
          updatedAt: valueText(item.updated_at),
        } as never;
      });
    },
    listSecureFormPayments: listSecureFormPaymentsServer,
    sendEventRegistrationEmail: sendEventRegistrationEmailNow,
    sendAutomationEmail: sendFormAutomationEmailNow,
    dispatchWorkspaceWorkflowEvent,
    syncSubmissionContact,
    updateContact,
  });
};

configureFormsDataRuntime();

class FormsDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "forms_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new FormsDataError(
      "Forms are temporarily unavailable. Please try again.",
      503,
      "forms_unavailable",
    );
  }
  return neon(url);
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new FormsDataError(
      "Forms are temporarily unavailable. Please try again.",
      503,
      "forms_unavailable",
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
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
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
    throw new FormsDataError(
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
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch (error) {
    if (error instanceof FormsDataError) throw error;
    throw new FormsDataError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
};

const optionalAuthenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  if (!authorization.startsWith("Bearer ") || !authorization.slice(7).trim()) {
    return null;
  }
  return authenticatedUserId(request);
};

const issuePublicFormAccessToken = (formId: string) =>
  new SignJWT({ formId, purpose: "public_form_access" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("maxform")
    .setAudience("maxform-public-form")
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(signingSecret());

const verifyPublicFormAccessToken = async (token: string, formId: string) => {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, signingSecret(), {
      audience: "maxform-public-form",
      issuer: "maxform",
    });
    return (
      payload.purpose === "public_form_access" &&
      String(payload.formId || "") === formId
    );
  } catch {
    return false;
  }
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 6_000_000) {
      throw new FormsDataError("This forms update is too large.", 413);
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
    throw new FormsDataError("The forms update could not be read.");
  }
};

const formRowsSql = (includeEventRegistrationForms: boolean) => `
  SELECT form.id,
         form.slug,
         form.project_id,
         (SELECT project.name
          FROM projects project
          WHERE project.id = form.project_id
            AND project.created_by = form.created_by
          LIMIT 1) AS project_name,
         form.title,
         form.description,
         form.status,
         form.created_by,
         form.created_at,
         form.updated_at,
         (SELECT company.brand_color
          FROM company_settings company
          WHERE company.user_id = form.created_by
          LIMIT 1) AS workspace_brand_color,
         COALESCE(form.fields, '[]'::jsonb) AS fields,
         COALESCE(form.settings, '{}'::jsonb) AS settings,
         jsonb_array_length(COALESCE(form.fields, '[]'::jsonb)) AS field_count,
         FALSE AS is_summary,
         (
           SELECT COUNT(*)
           FROM form_submissions submission
           WHERE submission.form_id = form.id
             AND COALESCE(submission.data #>> '{_meta,status}', 'completed')
               <> 'pending_payment'
         ) AS response_count
  FROM forms form
  WHERE form.created_by = $1
    ${
      includeEventRegistrationForms
        ? ""
        : `AND NOT EXISTS (
             SELECT 1
             FROM events event
             WHERE event.registration_form_id = form.id
           )`
    }
  ORDER BY form.updated_at DESC
`;

const formSummaryRowsSql = `
  SELECT form.id,
         form.slug,
         form.project_id,
         (SELECT project.name
          FROM projects project
          WHERE project.id = form.project_id
            AND project.created_by = form.created_by
          LIMIT 1) AS project_name,
         form.title,
         form.description,
         form.status,
         form.created_by,
         form.created_at,
         form.updated_at,
         (SELECT company.brand_color
          FROM company_settings company
          WHERE company.user_id = form.created_by
          LIMIT 1) AS workspace_brand_color,
         '[]'::jsonb AS fields,
         jsonb_build_object(
           'lifecycle', COALESCE(form.settings->>'lifecycle', 'active'),
           'hasUnpublishedChanges',
             COALESCE(
               (form.settings->>'hasUnpublishedChanges')::boolean,
               FALSE
             ),
           'archivedFromStatus', form.settings->>'archivedFromStatus',
           'payment', jsonb_build_object(
             'enabled',
               COALESCE(
                 (form.settings->'payment'->>'enabled')::boolean,
                 FALSE
               )
           )
         ) AS settings,
         jsonb_array_length(COALESCE(form.fields, '[]'::jsonb)) AS field_count,
         TRUE AS is_summary,
         (
           SELECT COUNT(*)
           FROM form_submissions submission
           WHERE submission.form_id = form.id
             AND COALESCE(submission.data #>> '{_meta,status}', 'completed')
               <> 'pending_payment'
         ) AS response_count
  FROM forms form
  WHERE form.created_by = $1
    AND NOT EXISTS (
      SELECT 1
      FROM events event
      WHERE event.registration_form_id = form.id
    )
  ORDER BY form.updated_at DESC
`;

const templateRowsSql = `
  SELECT template.id,
         template.group_name,
         template.name,
         template.description,
         template.payment,
         template.image_path,
         COALESCE(
           jsonb_agg(
             jsonb_strip_nulls(
               jsonb_build_object(
                 'id', template.id || '-field-' || field.position::text,
                 'type', field.field_type,
                 'label', field.label,
                 'placeholder', field.placeholder,
                 'helpText', field.help_text,
                 'required', field.required,
                 'options', field.options,
                 'defaultValue', field.default_value,
                 'formula', field.formula,
                 'width', field.width,
                 'validation', field.validation,
                 'config', field.config
               )
             )
             ORDER BY field.position
           ) FILTER (WHERE field.template_id IS NOT NULL),
           '[]'::jsonb
         ) AS fields
  FROM form_templates template
  LEFT JOIN form_template_fields field ON field.template_id = template.id
  WHERE template.active = TRUE
  GROUP BY template.id
  ORDER BY template.sort_order, template.name
`;

const bootstrap = async (response: ServerResponse, userId: string) => {
  const forms = await database().query(formSummaryRowsSql, [userId]);
  json(response, 200, { forms });
};

const getPreferences = async (response: ServerResponse, userId: string) => {
  const rows = await database().query(
    `SELECT preferences,
            (SELECT brand_color
             FROM company_settings
             WHERE user_id = $1
             LIMIT 1) AS workspace_brand_color
     FROM form_module_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  const row = rows[0] as RecordValue | undefined;
  const workspaceAccent = workspaceAccentColor(row?.workspace_brand_color);
  const existing =
    row?.preferences &&
    typeof row.preferences === "object" &&
    !Array.isArray(row.preferences)
      ? { ...(row.preferences as RecordValue) }
      : {};
  const accentColorMode =
    existing.accentColorMode === "custom" ||
    existing.accentColorMode === "workspace"
      ? existing.accentColorMode
      : inferAccentColorMode(
          existing.accentColor,
          workspaceAccent,
          LEGACY_FORM_ACCENTS,
        );
  const preferences: RecordValue = {
    ...existing,
    accentColorMode,
    accentColor: resolveAccentColor(
      existing.accentColor,
      workspaceAccent,
      accentColorMode,
      LEGACY_FORM_ACCENTS,
    ),
  };
  if (existing.confirmation && typeof existing.confirmation === "object") {
    preferences.confirmation = {
      ...(existing.confirmation as RecordValue),
      accentColor: resolveAccentColor(
        (existing.confirmation as RecordValue).accentColor,
        workspaceAccent,
        undefined,
        LEGACY_FORM_ACCENTS,
      ),
    };
  }
  json(response, 200, {
    preferences: row?.preferences || row?.workspace_brand_color
      ? preferences
      : null,
  });
};

const listTemplates = async (response: ServerResponse) => {
  const rows = await database().query(templateRowsSql);
  json(response, 200, { rows });
};

const listForms = async (
  response: ServerResponse,
  userId: string,
  url: URL,
) => {
  const includeEventRegistrationForms =
    url.searchParams.get("includeEventRegistrationForms") === "true";
  const rows = await database().query(
    formRowsSql(includeEventRegistrationForms),
    [userId],
  );
  json(response, 200, { rows });
};

const workspaceAnalytics = async (
  response: ServerResponse,
  userId: string,
) => {
  const sql = database();
  const [totalsRows, dailyRows, deviceRows, countryRows, formRows] =
    await Promise.all([
      sql.query(
        `WITH workspace_currency AS (
           SELECT COALESCE(
             (
               SELECT currency
               FROM workspace_regional_settings
               WHERE user_id = $1
               LIMIT 1
             ),
             'USD'
           ) AS currency
         ),
         workspace_submissions AS (
           SELECT submission.id,
                  COALESCE(
                    submission.data #>> '{_meta,status}',
                    'completed'
                  ) AS status
           FROM form_submissions submission
           JOIN forms form ON form.id = submission.form_id
           WHERE form.created_by = $1
             AND COALESCE(
               submission.data #>> '{_meta,status}',
               'completed'
             ) <> 'pending_payment'
         ),
         workspace_payments AS (
           SELECT payment.submission_id, payment.amount, payment.currency
           FROM payments payment
           JOIN workspace_submissions submission
             ON submission.id = payment.submission_id
           CROSS JOIN workspace_currency
           WHERE payment.status = 'completed'
             AND payment.currency = workspace_currency.currency
         )
         SELECT
           COUNT(*)::int AS responses,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'partial')::int AS partial,
           COALESCE(
             (SELECT COUNT(*) FROM workspace_payments),
             0
           )::int AS paid_responses,
           COALESCE(
             (SELECT SUM(amount) FROM workspace_payments),
             0
           )::numeric AS revenue,
           (SELECT currency FROM workspace_currency) AS currency
         FROM workspace_submissions`,
        [userId],
      ),
      sql.query(
        `WITH workspace_currency AS (
           SELECT COALESCE(
             (
               SELECT currency
               FROM workspace_regional_settings
               WHERE user_id = $1
               LIMIT 1
             ),
             'USD'
           ) AS currency
         ),
         response_days AS (
           SELECT submission.submitted_at::date AS date,
                  COUNT(*)::int AS responses
           FROM form_submissions submission
           JOIN forms form ON form.id = submission.form_id
           WHERE form.created_by = $1
             AND COALESCE(
               submission.data #>> '{_meta,status}',
               'completed'
             ) <> 'pending_payment'
           GROUP BY submission.submitted_at::date
         ),
         revenue_days AS (
           SELECT submission.submitted_at::date AS date,
                  COALESCE(SUM(payment.amount), 0)::numeric AS revenue
           FROM payments payment
           JOIN form_submissions submission
             ON submission.id = payment.submission_id
           JOIN forms form ON form.id = submission.form_id
           CROSS JOIN workspace_currency
           WHERE form.created_by = $1
             AND payment.status = 'completed'
             AND payment.currency = workspace_currency.currency
           GROUP BY submission.submitted_at::date
         )
         SELECT response_days.date::text,
                response_days.responses,
                COALESCE(revenue_days.revenue, 0)::numeric AS revenue
         FROM response_days
         LEFT JOIN revenue_days USING (date)
         ORDER BY response_days.date`,
        [userId],
      ),
      sql.query(
        `SELECT
           CASE
             WHEN submission.user_agent ~* '(ipad|tablet)'
               THEN 'Tablet'
             WHEN submission.user_agent ~* '(mobile|android|iphone|ipod)'
               THEN 'Mobile'
             ELSE 'Desktop'
           END AS device,
           COUNT(*)::int AS count
         FROM form_submissions submission
         JOIN forms form ON form.id = submission.form_id
         WHERE form.created_by = $1
           AND COALESCE(
             submission.data #>> '{_meta,status}',
             'completed'
           ) <> 'pending_payment'
         GROUP BY device
         ORDER BY count DESC`,
        [userId],
      ),
      sql.query(
        `SELECT submission.data #>> '{_meta,country}' AS country,
                COUNT(*)::int AS count
         FROM form_submissions submission
         JOIN forms form ON form.id = submission.form_id
         WHERE form.created_by = $1
           AND COALESCE(
             submission.data #>> '{_meta,status}',
             'completed'
           ) <> 'pending_payment'
           AND NULLIF(
             TRIM(submission.data #>> '{_meta,country}'),
             ''
           ) IS NOT NULL
         GROUP BY submission.data #>> '{_meta,country}'
         ORDER BY count DESC, country
         LIMIT 12`,
        [userId],
      ),
      sql.query(
        `WITH workspace_currency AS (
           SELECT COALESCE(
             (
               SELECT currency
               FROM workspace_regional_settings
               WHERE user_id = $1
               LIMIT 1
             ),
             'USD'
           ) AS currency
         ),
         form_responses AS (
           SELECT form.id,
                  form.title,
                  COUNT(submission.id)::int AS responses,
                  COUNT(submission.id) FILTER (
                    WHERE COALESCE(
                      submission.data #>> '{_meta,status}',
                      'completed'
                    ) = 'completed'
                  )::int AS completed,
                  COUNT(submission.id) FILTER (
                    WHERE submission.data #>> '{_meta,status}' = 'partial'
                  )::int AS partial
           FROM forms form
           LEFT JOIN form_submissions submission
             ON submission.form_id = form.id
            AND COALESCE(
              submission.data #>> '{_meta,status}',
              'completed'
            ) <> 'pending_payment'
           WHERE form.created_by = $1
             AND NOT EXISTS (
               SELECT 1
               FROM events event
               WHERE event.registration_form_id = form.id
             )
           GROUP BY form.id, form.title
         ),
         form_revenue AS (
           SELECT submission.form_id,
                  COALESCE(SUM(payment.amount), 0)::numeric AS revenue
           FROM payments payment
           JOIN form_submissions submission
             ON submission.id = payment.submission_id
           JOIN forms form ON form.id = submission.form_id
           CROSS JOIN workspace_currency
           WHERE form.created_by = $1
             AND payment.status = 'completed'
             AND payment.currency = workspace_currency.currency
           GROUP BY submission.form_id
         )
         SELECT response.id AS form_id,
                response.title,
                response.responses,
                response.completed,
                response.partial,
                COALESCE(revenue.revenue, 0)::numeric AS revenue
         FROM form_responses response
         LEFT JOIN form_revenue revenue ON revenue.form_id = response.id
         ORDER BY response.responses DESC, LOWER(response.title)
         LIMIT 50`,
        [userId],
      ),
    ]);
  const number = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const totals = (totalsRows[0] || {}) as RecordValue;
  json(response, 200, {
    analytics: {
      countries: countryRows.map((row) => ({
        country: String((row as RecordValue).country || ""),
        count: number((row as RecordValue).count),
      })),
      daily: dailyRows.map((row) => ({
        date: String((row as RecordValue).date || ""),
        responses: number((row as RecordValue).responses),
        revenue: number((row as RecordValue).revenue),
      })),
      devices: deviceRows.map((row) => ({
        device: String((row as RecordValue).device || "Desktop"),
        count: number((row as RecordValue).count),
      })),
      forms: formRows.map((row) => ({
        formId: String((row as RecordValue).form_id || ""),
        title: String((row as RecordValue).title || "Untitled form"),
        responses: number((row as RecordValue).responses),
        completed: number((row as RecordValue).completed),
        partial: number((row as RecordValue).partial),
        revenue: number((row as RecordValue).revenue),
      })),
      generatedAt: new Date().toISOString(),
      totals: {
        responses: number(totals.responses),
        completed: number(totals.completed),
        partial: number(totals.partial),
        paidResponses: number(totals.paid_responses),
        revenue: number(totals.revenue),
        currency: String(totals.currency || "USD"),
      },
    },
  });
};

const savePreferences = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
) => {
  const body = await readBody(request);
  const preferences = body.preferences;
  if (
    !preferences ||
    typeof preferences !== "object" ||
    Array.isArray(preferences)
  ) {
    throw new FormsDataError("Choose valid form defaults.");
  }
  const workspaceRows = await database().query(
    `SELECT brand_color
     FROM company_settings
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  const workspaceAccent = workspaceAccentColor(
    (workspaceRows[0] as RecordValue | undefined)?.brand_color,
  );
  const input = preferences as RecordValue;
  const accentColorMode =
    input.accentColorMode === "custom" ||
    input.accentColorMode === "workspace"
      ? input.accentColorMode
      : inferAccentColorMode(
          input.accentColor,
          workspaceAccent,
          LEGACY_FORM_ACCENTS,
        );
  const normalizedPreferences: RecordValue = {
    ...input,
    accentColorMode,
    accentColor: resolveAccentColor(
      input.accentColor,
      workspaceAccent,
      accentColorMode,
      LEGACY_FORM_ACCENTS,
    ),
  };
  if (input.confirmation && typeof input.confirmation === "object") {
    normalizedPreferences.confirmation = {
      ...(input.confirmation as RecordValue),
      accentColor: resolveAccentColor(
        (input.confirmation as RecordValue).accentColor,
        workspaceAccent,
        accentColorMode,
        LEGACY_FORM_ACCENTS,
      ),
    };
  }
  const rows = await database().query(
    `INSERT INTO form_module_preferences (
       user_id, preferences, created_at, updated_at
     )
     VALUES ($1, $2::jsonb, NOW(), NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       preferences = EXCLUDED.preferences,
       updated_at = NOW()
     RETURNING preferences`,
    [userId, JSON.stringify(normalizedPreferences)],
  );
  json(response, 200, {
    preferences: rows[0]?.preferences || normalizedPreferences,
  });
};

const rpcArgs = (body: RecordValue) => {
  if (!body.args || typeof body.args !== "object" || Array.isArray(body.args)) {
    return {} as RecordValue;
  }
  return body.args as RecordValue;
};

const publicFormKey = (formId: string, workspaceId?: string) =>
  cacheKey("public-form", workspaceId || "-", formId);

// Every visitor to a published form hits this, so it is the hottest read in
// the app. The TTL is short because a publish invalidates only the keys it can
// name, and a form reachable by both slug and id has two of them.
const withoutPublicFormSecrets = (form: Awaited<ReturnType<typeof getPublicForm>>) =>
  form
    ? {
        ...form,
        settings: {
          ...form.settings,
          access: { ...form.settings.access, password: "" },
        },
      }
    : null;

const cachedPublicForm = (formId: string, workspaceId?: string) =>
  cached(publicFormKey(formId, workspaceId), 60, () =>
    getPublicForm(formId, workspaceId).then(withoutPublicFormSecrets),
  );

const publicFormAccessRecord = async (formId: string) => {
  const rows = await database().query(
    `SELECT form.id,
       COALESCE(settings.access_control, form.settings->'access', '{}'::jsonb)
         AS access_control
     FROM forms form
     LEFT JOIN form_settings settings ON settings.form_id = form.id
     WHERE (form.slug = $1 OR form.id::text = $1)
       AND form.status = 'published'
     LIMIT 1`,
    [formId],
  );
  const row = rows[0] as RecordValue | undefined;
  if (!row) return null;
  const access =
    row.access_control &&
    typeof row.access_control === "object" &&
    !Array.isArray(row.access_control)
      ? (row.access_control as RecordValue)
      : {};
  return {
    formId: valueText(row.id),
    mode: valueText(access.mode) || "public",
    password: valueText(access.password),
  };
};

/**
 * Drops the cached copies of a form after it changes. Both the slug and the id
 * address the same form, and a form is reachable with or without its workspace
 * prefix, so all four keys go.
 */
const invalidatePublicForm = async (
  form: { id?: string; slug?: string } | null,
  workspaceShortId: string,
) => {
  const identifiers = [form?.id, form?.slug].filter(
    (value): value is string => Boolean(value),
  );
  await cacheDelete(
    ...identifiers.flatMap((identifier) => [
      publicFormKey(identifier),
      publicFormKey(identifier, workspaceShortId),
    ]),
  );
};

const workspaceShortIdFor = async (userId: string) => {
  const rows = await database().query(
    `SELECT short_id FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return String((rows[0] as RecordValue | undefined)?.short_id ?? "").trim();
};

const executeFormsRpc = async (
  operation: string,
  args: RecordValue,
  userId: string | null,
) => {
  const authenticatedId = () => {
    if (!userId) {
      throw new FormsDataError(
        "Your session has expired. Sign in and try again.",
        401,
        "authentication_required",
      );
    }
    return userId;
  };
  switch (operation) {
    case "isFormSlugAvailable":
      return isFormSlugAvailable(
        valueText(args.slug),
        valueText(args.formId),
      );
    case "createWorkspaceForm": {
      const owner = authenticatedId();
      const requested = args.input as Parameters<typeof createWorkspaceForm>[1];
      // The project arrives from the client, so it is resolved against what
      // this user may actually file into before it reaches the insert.
      return createWorkspaceForm(owner, {
        ...requested,
        projectId: await resolveOwnedProjectId(owner, requested?.projectId),
      });
    }
    case "saveWorkspaceForm": {
      const owner = authenticatedId();
      const previous = args.form as { id?: string; slug?: string };
      const saved = await saveWorkspaceForm(
        owner,
        args.form as Parameters<typeof saveWorkspaceForm>[1],
      );
      const workspaceShortId = await workspaceShortIdFor(owner);
      // The slug can change in the same save, so the keys for both the old and
      // the new address are dropped.
      await invalidatePublicForm(previous, workspaceShortId);
      await invalidatePublicForm(saved, workspaceShortId);
      return saved;
    }
    case "deleteWorkspaceForm": {
      const owner = authenticatedId();
      const formId = valueText(args.formId);
      const rows = await database().query(
        `SELECT id, slug FROM forms WHERE id = $1 AND created_by = $2 LIMIT 1`,
        [formId, owner],
      );
      const removed = await deleteWorkspaceForm(owner, formId);
      await invalidatePublicForm(
        (rows[0] as { id?: string; slug?: string } | undefined) || {
          id: formId,
        },
        await workspaceShortIdFor(owner),
      );
      return removed;
    }
    case "listFormSubmissions":
      return listFormSubmissions(
        authenticatedId(),
        valueText(args.formId),
      );
    case "updateFormSubmission":
      return updateFormSubmission(
        authenticatedId(),
        args.submission as Parameters<typeof updateFormSubmission>[1],
      );
    case "deleteFormSubmissions":
      return deleteFormSubmissions(
        authenticatedId(),
        valueText(args.formId),
        Array.isArray(args.submissionIds)
          ? args.submissionIds.map(valueText)
          : [],
      );
    case "listFormWorkflows":
      return listFormWorkflows(authenticatedId(), valueText(args.formId));
    case "createFormWorkflow":
      return createFormWorkflow(
        authenticatedId(),
        valueText(args.formId),
        args.input as Parameters<typeof createFormWorkflow>[2],
      );
    case "updateFormWorkflow":
      return updateFormWorkflow(
        authenticatedId(),
        valueText(args.formId),
        valueText(args.workflowId),
        args.input as Parameters<typeof updateFormWorkflow>[3],
      );
    case "setFormWorkflowEnabled":
      return setFormWorkflowEnabled(
        authenticatedId(),
        valueText(args.workflowId),
        valueBoolean(args.enabled),
      );
    case "duplicateFormWorkflow":
      return duplicateFormWorkflow(
        authenticatedId(),
        args.workflow as Parameters<typeof duplicateFormWorkflow>[1],
      );
    case "deleteFormWorkflow":
      return deleteFormWorkflow(
        authenticatedId(),
        valueText(args.workflowId),
      );
    case "listAutomationConnections":
      return listAutomationConnections(authenticatedId());
    case "listAutomationProviders":
      return listAutomationProviders();
    case "saveAutomationConnection":
      return saveAutomationConnection(
        authenticatedId(),
        args.input as Parameters<typeof saveAutomationConnection>[1],
      );
    case "testAutomationConnection":
      return testAutomationConnection(
        authenticatedId(),
        args.connection as Parameters<typeof testAutomationConnection>[1],
      );
    case "deleteAutomationConnection":
      return deleteAutomationConnection(
        authenticatedId(),
        valueText(args.connectionId),
      );
    case "listAutomationRuns":
      return listAutomationRuns(authenticatedId(), valueText(args.formId));
    case "getPublicForm":
      return cachedPublicForm(
        valueText(args.formId),
        valueText(args.workspaceId) || undefined,
      );
    case "verifyPublicFormAccess": {
      const access = await publicFormAccessRecord(valueText(args.formId));
      if (!access) {
        throw new FormsDataError(
          "This form is no longer accepting responses.",
          404,
          "form_not_available",
        );
      }
      if (access.mode !== "password") {
        throw new FormsDataError("This form does not require a password.", 409);
      }
      if (!access.password || valueText(args.password) !== access.password) {
        throw new FormsDataError(
          "That password is not correct.",
          403,
          "form_password_invalid",
        );
      }
      return { accessToken: await issuePublicFormAccessToken(access.formId) };
    }
    case "submitPublicForm":
      {
        const form = await cachedPublicForm(valueText(args.formId));
        if (!form) {
          throw new FormsDataError(
            "This form is no longer accepting responses.",
            404,
            "form_not_available",
          );
        }
        if (
          form.settings.access.mode === "authenticated" &&
          !userId
        ) {
          throw new FormsDataError(
            "Sign in before submitting this form.",
            401,
            "form_authentication_required",
          );
        }
        if (
          form.settings.access.mode === "password" &&
          !(await verifyPublicFormAccessToken(
            valueText((args.options as RecordValue | undefined)?.accessToken),
            form.id,
          ))
        ) {
          throw new FormsDataError(
            "Enter the form password again before submitting.",
            403,
            "form_access_required",
          );
        }
        const suppliedAnswers =
          args.storedAnswers &&
          typeof args.storedAnswers === "object" &&
          !Array.isArray(args.storedAnswers)
            ? (args.storedAnswers as RecordValue)
            : {};
        const allowedFields = new Set(form.fields.map((field) => field.id));
        const storedAnswers = Object.fromEntries(
          Object.entries(suppliedAnswers).filter(([fieldId]) =>
            allowedFields.has(fieldId),
          ),
        );
        return submitPreparedPublicForm(
          form,
          storedAnswers,
          Array.isArray(args.storedMedia)
            ? (args.storedMedia as Parameters<
                typeof submitPreparedPublicForm
              >[2])
            : [],
          args.meta as Parameters<typeof submitPreparedPublicForm>[3],
          args.options as Parameters<typeof submitPreparedPublicForm>[4],
        );
      }
    default:
      throw new FormsDataError("This forms action is not available.", 404);
  }
};

export async function handleFormsData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "bootstrap";
    if (request.method === "POST" && action === "rpc") {
      const body = await readBody(request);
      const operation = valueText(body.operation);
      const publicOperation =
        operation === "getPublicForm" ||
        operation === "verifyPublicFormAccess" ||
        operation === "submitPublicForm";
      const args = rpcArgs(body);
      if (operation === "submitPublicForm") {
        const formId = valueText(args.formId) || "unknown";
        const [clientLimit, formLimit] = await Promise.all([
          consumeRateLimit({
            action: "public-form-submit-client",
            identifier: requestClientIdentifier(request),
            limit: 30,
            windowSeconds: 60,
          }),
          consumeRateLimit({
            action: "public-form-submit-form",
            identifier: formId,
            limit: 3_000,
            windowSeconds: 60,
          }),
        ]);
        if (!clientLimit.allowed || !formLimit.allowed) {
          throw new FormsDataError(
            "Too many responses were submitted. Please wait a moment and try again.",
            429,
            "form_submission_rate_limited",
          );
        }
      }
      const userId = publicOperation
        ? operation === "submitPublicForm"
          ? await optionalAuthenticatedUserId(request)
          : null
        : await authenticatedUserId(request);
      const value = await executeFormsRpc(operation, args, userId);
      json(response, 200, { value });
      return;
    }

    const userId = await authenticatedUserId(request);

    if (request.method === "GET" && action === "bootstrap") {
      await bootstrap(response, userId);
      return;
    }
    if (request.method === "GET" && action === "forms") {
      await listForms(response, userId, url);
      return;
    }
    if (request.method === "GET" && action === "analytics") {
      await workspaceAnalytics(response, userId);
      return;
    }
    if (request.method === "GET" && action === "templates") {
      await listTemplates(response);
      return;
    }
    if (request.method === "GET" && action === "preferences") {
      await getPreferences(response, userId);
      return;
    }
    if (request.method === "POST" && action === "preferences") {
      await savePreferences(request, response, userId);
      return;
    }

    json(response, 404, { error: "This forms action is not available." });
  } catch (error) {
    if (error instanceof FormsDataError) {
      json(response, error.status, {
        code: error.code,
        error: error.message,
      });
      return;
    }
    const unexpectedCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "unknown")
        : "unknown";
    console.error("[forms-data] unexpected request failure", {
      code: unexpectedCode,
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      code: "forms_unavailable",
      error: "Forms could not be loaded. Please try again.",
    });
  }
}

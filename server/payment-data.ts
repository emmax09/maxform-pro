import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import { syncPaidOrderToCrm } from "./payment-checkout";
import { workspaceScopeFor } from "./workspace-access";

type RecordValue = Record<string, unknown>;
type Provider = "stripe" | "paypal" | "paystack" | "opay";

class PaymentDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "payment_data_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new PaymentDataError(
      "Payments are temporarily unavailable. Please try again later.",
      503,
      "payments_unavailable",
    );
  }
  return neon(url);
};

const jwtSigningSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new PaymentDataError(
      "Payments are temporarily unavailable. Please try again later.",
      503,
      "payments_unavailable",
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
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.end(JSON.stringify(value));
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    throw new PaymentDataError(
      "Please sign in again to manage payments.",
      401,
      "authentication_required",
    );
  }
  try {
    const { payload } = await jwtVerify(token, jwtSigningSecret(), {
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
    if (error instanceof PaymentDataError) throw error;
    throw new PaymentDataError(
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
      throw new PaymentDataError("This payment request is too large.", 413);
    }
  }
  if (!body) return {} as RecordValue;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid body");
    }
    return parsed as RecordValue;
  } catch {
    throw new PaymentDataError("The payment request could not be read.");
  }
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const requiredUuid = (value: unknown, label: string) => {
  const id = String(value || "");
  if (!isUuid(id)) {
    throw new PaymentDataError(`${label} could not be found.`, 404);
  }
  return id;
};

const text = (value: unknown, max: number) =>
  String(value ?? "").trim().slice(0, max);

const requiredText = (value: unknown, label: string, max: number) => {
  const result = text(value, max);
  if (!result) throw new PaymentDataError(`${label} is required.`);
  return result;
};

const money = (value: unknown, label: string, allowZero = true) => {
  const result = Number(value);
  if (
    !Number.isFinite(result) ||
    result < (allowZero ? 0 : 0.01) ||
    result > 100_000_000
  ) {
    throw new PaymentDataError(`Enter a valid ${label.toLowerCase()}.`);
  }
  return Math.round(result * 100) / 100;
};

const currency = (value: unknown) => {
  const result = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) {
    throw new PaymentDataError("Choose a valid currency.");
  }
  return result;
};

const boolean = (value: unknown) => value === true;

const optionalDate = (value: unknown, label: string) => {
  const result = String(value || "").trim();
  if (!result) return null;
  const parsed = new Date(result);
  if (Number.isNaN(parsed.valueOf())) {
    throw new PaymentDataError(`Choose a valid ${label.toLowerCase()}.`);
  }
  return parsed.toISOString();
};

const couponTarget = (value: unknown, label: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentDataError(`Choose a valid ${label.toLowerCase()}.`);
  }
  const target = value as RecordValue;
  const type =
    target.type === "event"
      ? "event"
      : target.type === "form"
        ? "form"
        : "";
  if (!type) {
    throw new PaymentDataError(`Choose a valid ${label.toLowerCase()}.`);
  }
  return {
    id: requiredUuid(target.id, label),
    type,
  };
};

const isProvider = (value: string): value is Provider =>
  ["stripe", "paypal", "paystack", "opay"].includes(value);

const safeConnectionColumns = `
  id, provider, auth_type, status,
  ''::text AS external_account_id,
  external_account_name, credential_hint, is_default, health_ok,
  last_checked_at,
  CASE
    WHEN status = 'attention' THEN 'Reconnect this provider to continue.'
    ELSE ''
  END AS last_error,
  connected_at
`;

const safeProductColumns = `
  id, name, description, short_description, sku, price, sale_price, currency, billing_type,
  billing_interval, source_type, source_id, image_url, taxable, tax_rate,
  requires_shipping, track_inventory, inventory_quantity,
  low_stock_threshold, allow_backorder, weight_grams, options, image_gallery,
  promotional_banner, category, product_status, availability_start_at,
  availability_end_at, min_quantity, max_quantity, one_per_customer,
  hide_when_sold_out, active,
  created_at, updated_at
`;

const productSelectColumns = `
  payment_products.id, payment_products.name, payment_products.description,
  payment_products.short_description, payment_products.sku,
  payment_products.price, payment_products.sale_price, payment_products.currency,
  payment_products.billing_type, payment_products.billing_interval,
  payment_products.source_type, payment_products.source_id,
  payment_products.image_url, payment_products.taxable,
  payment_products.tax_rate, payment_products.requires_shipping,
  payment_products.track_inventory, payment_products.inventory_quantity,
  payment_products.low_stock_threshold, payment_products.allow_backorder,
  payment_products.weight_grams, payment_products.options,
  payment_products.image_gallery, payment_products.promotional_banner,
  payment_products.category, payment_products.product_status,
  payment_products.availability_start_at, payment_products.availability_end_at,
  payment_products.min_quantity, payment_products.max_quantity,
  payment_products.one_per_customer, payment_products.hide_when_sold_out,
  payment_products.active, payment_products.created_at,
  payment_products.updated_at,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', variant.id,
      'name', variant.name,
      'sku', variant.sku,
      'price', variant.price,
      'salePrice', variant.sale_price,
      'description', variant.description,
      'optionValues', variant.option_values,
      'imageUrl', variant.image_url,
      'trackInventory', variant.track_inventory,
      'inventoryQuantity', variant.inventory_quantity,
      'lowStockThreshold', variant.low_stock_threshold,
      'allowBackorder', variant.allow_backorder,
      'weightGrams', variant.weight_grams,
      'availabilityStartAt', variant.availability_start_at,
      'availabilityEndAt', variant.availability_end_at,
      'active', variant.active,
      'sortOrder', variant.sort_order
    ) ORDER BY variant.sort_order, variant.created_at)
    FROM payment_product_variants variant
    WHERE variant.product_id = payment_products.id
  ), '[]'::jsonb) AS variants
`;

export async function hasConnectedPaymentProviderServer(
  userId: string,
  provider: Provider | "workspace" = "workspace",
  recurringOnly = false,
) {
  if (provider !== "workspace" && !isProvider(provider)) {
    throw new PaymentDataError("Choose a valid payment provider.");
  }
  const rows = await database().query(
    `SELECT EXISTS (
       SELECT 1
       FROM payment_provider_connections
       WHERE user_id = $1
         AND status = 'connected'
         AND health_ok = TRUE
         AND ($2 = 'workspace' OR provider = $2)
         AND ($3 = FALSE OR provider IN ('stripe', 'paypal', 'paystack'))
     ) AS connected`,
    [userId, provider, recurringOnly],
  );
  return Boolean((rows[0] as RecordValue | undefined)?.connected);
}

export async function listPaymentProductsServer(userId: string) {
  return database().query(
    `SELECT ${productSelectColumns}
     FROM payment_products
     WHERE user_id = $1 AND active = TRUE
     ORDER BY updated_at DESC`,
    [userId],
  );
}

export async function listSecureFormPaymentsServer(
  userId: string,
  formIdValue: string,
) {
  const formId = requiredUuid(formIdValue, "Form");
  return database().query(
    `SELECT payment.id, payment.submission_id, payment.amount,
            payment.currency, payment.provider, payment.status,
            payment.payment_date
     FROM payments payment
     JOIN form_submissions submission ON submission.id = payment.submission_id
     JOIN forms form ON form.id = submission.form_id
     WHERE form.id = $1 AND form.created_by = $2
     ORDER BY payment.payment_date DESC`,
    [formId, userId],
  );
}

export async function syncFormPaymentProductServer(
  userId: string,
  formIdValue: string,
) {
  const formId = requiredUuid(formIdValue, "Form");
  const sql = database();
  const rows = await sql.query(
    `SELECT form.title, form.description, settings.payment
     FROM forms form
     JOIN form_settings settings ON settings.form_id = form.id
     WHERE form.id = $1 AND form.created_by = $2
     LIMIT 1`,
    [formId, userId],
  );
  if (rows.length !== 1) {
    throw new PaymentDataError("Form could not be found.", 404);
  }
  const form = rows[0] as RecordValue;
  const payment =
    form.payment && typeof form.payment === "object"
      ? (form.payment as RecordValue)
      : {};
  if (payment.enabled !== true || String(payment.mode || "") !== "fixed") {
    await sql.query(
      `UPDATE payment_products
       SET active = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND source_type = 'form' AND source_id = $2`,
      [userId, formId],
    );
    return;
  }
  await sql.query(
    `INSERT INTO payment_products (
       user_id, name, description, price, currency, billing_type,
       source_type, source_id, active, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 'one_time', 'form', $6, TRUE, NOW(), NOW())
     ON CONFLICT (user_id, source_type, source_id)
       WHERE source_id IS NOT NULL
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       price = EXCLUDED.price,
       currency = EXCLUDED.currency,
       active = TRUE,
       updated_at = NOW()`,
    [
      userId,
      requiredText(form.title, "Form name", 160),
      text(form.description, 2000),
      money(payment.amount, "Amount"),
      currency(payment.currency),
      formId,
    ],
  );
}

export async function syncEventTicketPaymentProductServer(
  userId: string,
  ticketTypeIdValue: string,
) {
  const ticketTypeId = requiredUuid(ticketTypeIdValue, "Ticket type");
  const sql = database();
  const rows = await sql.query(
    `INSERT INTO payment_products (
       user_id, name, description, price, currency, billing_type,
       source_type, source_id, active, created_at, updated_at
     )
     SELECT event.created_by,
       event.title || ' - ' || ticket_type.name,
       ticket_type.description, ticket_type.price, ticket_type.currency,
       'one_time', 'ticket_type', ticket_type.id, ticket_type.active,
       NOW(), NOW()
     FROM event_ticket_types ticket_type
     JOIN events event ON event.id = ticket_type.event_id
     WHERE ticket_type.id = $1 AND event.created_by = $2
     ON CONFLICT (user_id, source_type, source_id)
       WHERE source_id IS NOT NULL
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       price = EXCLUDED.price,
       currency = EXCLUDED.currency,
       active = EXCLUDED.active,
       updated_at = NOW()
     RETURNING id`,
    [ticketTypeId, userId],
  );
  if (!rows[0]) {
    throw new PaymentDataError("Ticket type could not be found.", 404);
  }
  await sql.query(
    `UPDATE event_ticket_types
     SET product_id = $1, updated_at = NOW()
     WHERE id = $2
       AND EXISTS (
         SELECT 1 FROM events
         WHERE events.id = event_ticket_types.event_id
           AND events.created_by = $3
       )`,
    [(rows[0] as RecordValue).id, ticketTypeId, userId],
  );
}

export async function deactivateEventTicketPaymentProductServer(
  userId: string,
  ticketTypeIdValue: string,
) {
  const ticketTypeId = requiredUuid(ticketTypeIdValue, "Ticket type");
  await database().query(
    `UPDATE payment_products
     SET active = FALSE, updated_at = NOW()
     WHERE user_id = $1
       AND source_type = 'ticket_type'
       AND source_id = $2`,
    [userId, ticketTypeId],
  );
}

const eligibleCouponTargets = async (userId: string) => {
  const sql = database();
  return sql.query(
    `WITH eligible_forms AS (
       SELECT form.id,
              'form'::text AS type,
              form.title AS name,
              CASE COALESCE(settings.payment->>'mode', 'fixed')
                WHEN 'variable' THEN 'Customer chooses the amount'
                WHEN 'product' THEN
                  COALESCE(product.name, 'Product checkout')
                ELSE
                  COALESCE(settings.payment->>'currency', 'USD') || ' ' ||
                  TO_CHAR(
                    COALESCE((settings.payment->>'amount')::numeric, 0),
                    'FM999999999990.00'
                  )
              END AS detail,
              COALESCE(
                product.currency,
                NULLIF(settings.payment->>'currency', ''),
                'USD'
              ) AS currency,
              COALESCE(
                (settings.payment->>'allowCoupons')::boolean,
                FALSE
              ) OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(form.fields, '[]'::jsonb))
                  product_field
                WHERE product_field->>'type' = 'product'
                  AND COALESCE(
                    (product_field->'config'->>'productCouponsEnabled')::boolean,
                    FALSE
                  ) = TRUE
              ) AS coupons_enabled
       FROM forms form
       JOIN form_settings settings ON settings.form_id = form.id
       LEFT JOIN payment_products product
         ON product.id::text = settings.payment->>'productId'
        AND product.user_id = form.created_by
        AND product.active = TRUE
       WHERE form.created_by = $1
         AND COALESCE((settings.payment->>'enabled')::boolean, FALSE) = TRUE
         AND (
           settings.payment->>'mode' = 'variable'
         OR COALESCE((settings.payment->>'amount')::numeric, 0) > 0
         OR product.id IS NOT NULL
         OR (
           settings.payment->>'mode' = 'cart'
           AND COALESCE(
             (settings.payment->>'productCommerceEnabled')::boolean,
             TRUE
           ) = TRUE
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements(COALESCE(form.fields, '[]'::jsonb))
               product_field
             WHERE product_field->>'type' = 'product'
               AND jsonb_array_length(
                 CASE
                   WHEN jsonb_typeof(product_field->'config'->'productIds') = 'array'
                     THEN product_field->'config'->'productIds'
                   ELSE '[]'::jsonb
                 END
               ) > 0
           )
         )
       )
         AND NOT EXISTS (
           SELECT 1
           FROM events event
           WHERE event.registration_form_id = form.id
         )
     ),
     eligible_events AS (
       SELECT event.id,
              'event'::text AS type,
              event.title AS name,
              CASE
                WHEN event.ticketing_enabled THEN
                  ticket.paid_count::text || ' paid ticket ' ||
                  CASE WHEN ticket.paid_count = 1 THEN 'type' ELSE 'types' END
                ELSE
                  COALESCE(pricing.label, 'Registration fee') || ' - ' ||
                  pricing.currency || ' ' ||
                  TO_CHAR(pricing.amount, 'FM999999999990.00')
              END AS detail,
              COALESCE(ticket.currency, pricing.currency, 'USD') AS currency,
              COALESCE(pricing.coupons_enabled, FALSE) AS coupons_enabled
       FROM events event
       LEFT JOIN event_pricing pricing ON pricing.event_id = event.id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::integer AS paid_count,
                MIN(ticket_type.currency) AS currency
         FROM event_ticket_types ticket_type
         WHERE ticket_type.event_id = event.id
           AND ticket_type.active = TRUE
           AND ticket_type.price > 0
       ) ticket ON TRUE
       WHERE event.created_by = $1
         AND (
           (event.ticketing_enabled = TRUE AND ticket.paid_count > 0)
           OR (
             event.ticketing_enabled = FALSE
             AND pricing.enabled = TRUE
             AND pricing.amount > 0
           )
         )
     )
     SELECT id, type, name, detail, currency, coupons_enabled
     FROM (
       SELECT * FROM eligible_forms
       UNION ALL
       SELECT * FROM eligible_events
     ) target
     ORDER BY type, LOWER(name)`,
    [userId],
  );
};

const listConnections = async (
  response: ServerResponse,
  userId: string,
  healthyOnly: boolean,
) => {
  const sql = database();
  const rows = healthyOnly
    ? await sql.query(
        `SELECT ${safeConnectionColumns}
         FROM payment_provider_connections
         WHERE user_id = $1
           AND status = 'connected'
           AND health_ok = TRUE
         ORDER BY is_default DESC, provider`,
        [userId],
      )
    : await sql.query(
        `SELECT ${safeConnectionColumns}
         FROM payment_provider_connections
         WHERE user_id = $1 AND status <> 'disconnected'
         ORDER BY is_default DESC, provider`,
        [userId],
      );
  json(response, 200, { rows });
};

const listProducts = async (response: ServerResponse, userId: string) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT ${productSelectColumns}
     FROM payment_products
     WHERE user_id = $1 AND active = TRUE
     ORDER BY updated_at DESC`,
    [userId],
  );
  json(response, 200, { rows });
};

const hasProvider = async (
  response: ServerResponse,
  userId: string,
  url: URL,
) => {
  const providerValue = url.searchParams.get("provider") || "workspace";
  const recurringOnly = url.searchParams.get("recurring") === "true";
  if (providerValue !== "workspace" && !isProvider(providerValue)) {
    throw new PaymentDataError("Choose a valid payment provider.");
  }
  const sql = database();
  const rows = await sql.query(
    `SELECT EXISTS (
       SELECT 1
       FROM payment_provider_connections
       WHERE user_id = $1
         AND status = 'connected'
         AND health_ok = TRUE
         AND ($2 = 'workspace' OR provider = $2)
         AND ($3 = FALSE OR provider IN ('stripe', 'paypal', 'paystack'))
     ) AS connected`,
    [userId, providerValue, recurringOnly],
  );
  json(response, 200, {
    connected: Boolean((rows[0] as RecordValue | undefined)?.connected),
  });
};

const listFormPayments = async (
  response: ServerResponse,
  userId: string,
  url: URL,
) => {
  const formId = requiredUuid(url.searchParams.get("formId"), "Form");
  const sql = database();
  const rows = await sql.query(
    `SELECT payment.id, payment.submission_id, payment.amount,
            payment.currency, payment.provider, payment.status,
            payment.payment_date
     FROM payments payment
     JOIN form_submissions submission ON submission.id = payment.submission_id
     JOIN forms form ON form.id = submission.form_id
     WHERE form.id = $1 AND form.created_by = $2
     ORDER BY payment.payment_date DESC`,
    [formId, userId],
  );
  json(response, 200, { rows });
};

const listContactPayments = async (
  response: ServerResponse,
  userId: string,
  url: URL,
) => {
  const contactEmail = String(url.searchParams.get("email") || "")
    .trim()
    .toLowerCase();
  if (
    contactEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
  ) {
    throw new PaymentDataError("Enter a valid contact email.");
  }
  const sql = database();
  const rows = await sql.query(
    `SELECT payment_order.id, payment_order.total_amount AS amount,
            payment_order.currency, payment_order.status,
            COALESCE(payment_order.paid_at, payment_order.created_at)
              AS created_at,
            COALESCE(
              NULLIF(payment_order.metadata->>'sourceLabel', ''),
              form.title,
              event.title,
              invoice.invoice_number,
              payment_order.order_number
            ) AS form_title
     FROM payment_orders payment_order
     LEFT JOIN forms form
       ON payment_order.source_type = 'form'
      AND form.id = payment_order.source_id
     LEFT JOIN events event
       ON payment_order.source_type = 'event'
      AND event.id = payment_order.source_id
     LEFT JOIN payment_invoices invoice
       ON payment_order.source_type = 'invoice'
      AND invoice.id = payment_order.source_id
     WHERE payment_order.user_id = $1
       AND LOWER(TRIM(payment_order.customer_email)) = $2
       AND payment_order.status IN ('paid', 'partially_refunded', 'refunded')
     ORDER BY COALESCE(payment_order.paid_at, payment_order.created_at) DESC`,
    [userId, contactEmail],
  );
  json(response, 200, { rows });
};

const listWorkspace = async (response: ServerResponse, userId: string) => {
  const sql = database();
  const [
    connections,
    products,
    coupons,
    couponTargets,
    orders,
    invoices,
    subscriptions,
    refunds,
    inventoryAlerts,
  ] = await Promise.all([
    sql.query(
      `SELECT ${safeConnectionColumns}
       FROM payment_provider_connections
       WHERE user_id = $1 AND status <> 'disconnected'
       ORDER BY is_default DESC, provider`,
      [userId],
    ),
    sql.query(
      `SELECT ${productSelectColumns}
       FROM payment_products
       WHERE user_id = $1
       ORDER BY active DESC, updated_at DESC`,
      [userId],
    ),
    sql.query(
       `SELECT id, code, name, description, discount_type, discount_value, currency,
              redemption_limit, redemption_limit_per_customer,
              redemption_limit_per_identity,
              redemption_count, minimum_amount, maximum_discount, applies_to,
              eligible_product_ids, excluded_product_ids, direct_target,
              starts_at, ends_at, active, created_at, updated_at
       FROM payment_coupons
       WHERE user_id = $1
       ORDER BY active DESC, updated_at DESC`,
      [userId],
    ),
    eligibleCouponTargets(userId),
    sql.query(
      `SELECT payment_order.id, payment_order.order_number,
              payment_order.source_type, payment_order.source_id,
              payment_order.contact_id,
              payment_order.customer_name, payment_order.customer_email,
              payment_order.status, payment_order.provider,
              payment_order.subtotal,
              payment_order.discount_amount, payment_order.tax_amount,
              payment_order.shipping_amount,
              payment_order.total_amount, payment_order.refunded_amount,
              payment_order.currency, payment_order.payment_method_summary,
              CASE
                WHEN payment_order.status = 'failed'
                  THEN 'Payment could not be completed.'
                ELSE ''
              END AS failure_reason,
              payment_order.paid_at, payment_order.created_at,
              COALESCE(
                NULLIF(payment_order.metadata->>'sourceLabel', ''),
                form.title,
                event.title,
                invoice.invoice_number,
                ''
              )
                AS source_name,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'id', item.id,
                    'productId', item.product_id,
                    'variantId', item.variant_id,
                    'sku', item.sku,
                    'variantName', item.variant_name,
                    'name', item.name,
                    'description', item.description,
                    'quantity', item.quantity,
                    'unitPrice', item.unit_price,
                    'totalAmount', item.total_amount
                  )
                  ORDER BY item.created_at
                ) FILTER (WHERE item.id IS NOT NULL),
                '[]'::jsonb
              ) AS items
       FROM payment_orders payment_order
       LEFT JOIN forms form
         ON payment_order.source_type = 'form'
        AND form.id = payment_order.source_id
       LEFT JOIN events event
         ON payment_order.source_type = 'event'
        AND event.id = payment_order.source_id
       LEFT JOIN payment_invoices invoice
         ON payment_order.source_type = 'invoice'
        AND invoice.id = payment_order.source_id
       LEFT JOIN payment_order_items item ON item.order_id = payment_order.id
       WHERE payment_order.user_id = $1
       GROUP BY payment_order.id, form.title, event.title,
                invoice.invoice_number
       ORDER BY payment_order.created_at DESC
       LIMIT 500`,
      [userId],
    ),
    sql.query(
      `SELECT id, order_id, invoice_number, customer_name, customer_email,
              status, amount_due, amount_paid, currency, due_at, sent_at,
              paid_at, memo, line_items, created_at, updated_at
       FROM payment_invoices
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [userId],
    ),
    sql.query(
      `SELECT subscription.id, subscription.product_id,
              COALESCE(product.name, 'Subscription') AS product_name,
              connection.provider, subscription.customer_name,
              subscription.customer_email, subscription.status,
              subscription.amount, subscription.currency,
              subscription.interval_unit, subscription.current_period_start,
              subscription.current_period_end,
              subscription.cancel_at_period_end, subscription.created_at,
              subscription.updated_at
       FROM payment_subscriptions subscription
       LEFT JOIN payment_products product
         ON product.id = subscription.product_id
       LEFT JOIN payment_provider_connections connection
         ON connection.id = subscription.provider_connection_id
       WHERE subscription.user_id = $1
       ORDER BY subscription.updated_at DESC
       LIMIT 500`,
      [userId],
    ),
    sql.query(
      `SELECT refund.id, refund.order_id, payment_order.order_number,
              refund.provider, refund.amount, refund.currency, refund.reason,
              refund.status,
              CASE
                WHEN refund.status = 'failed'
                  THEN 'The refund could not be completed.'
                ELSE ''
              END AS failure_reason,
              refund.requested_at, refund.completed_at
       FROM payment_refunds refund
       JOIN payment_orders payment_order ON payment_order.id = refund.order_id
       WHERE refund.user_id = $1
       ORDER BY refund.requested_at DESC
       LIMIT 500`,
      [userId],
    ),
    sql.query(
      `SELECT alert.id, alert.product_id, alert.variant_id, alert.status,
              alert.quantity, alert.threshold, alert.message,
              alert.created_at, alert.updated_at,
              product.name AS product_name,
              COALESCE(variant.name, '') AS variant_name
       FROM payment_inventory_alerts alert
       JOIN payment_products product ON product.id = alert.product_id
       LEFT JOIN payment_product_variants variant ON variant.id = alert.variant_id
       WHERE alert.user_id = $1
         AND alert.status IN ('open', 'acknowledged')
       ORDER BY CASE WHEN alert.status = 'open' THEN 0 ELSE 1 END,
                alert.updated_at DESC
       LIMIT 200`,
      [userId],
    ),
  ]);
  json(response, 200, {
    workspace: {
      connections,
      products,
      coupons,
      couponTargets,
      orders,
      invoices,
      subscriptions,
      refunds,
      inventoryAlerts,
    },
  });
};

const adjustInventory = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const productId = requiredUuid(body.productId, "Product");
  const variantIdValue = String(body.variantId || "").trim();
  const variantId = variantIdValue ? requiredUuid(variantIdValue, "Variant") : null;
  const adjustment = Math.trunc(Number(body.adjustment));
  if (!Number.isInteger(adjustment) || adjustment === 0 || Math.abs(adjustment) > 1_000_000) {
    throw new PaymentDataError("Enter a valid inventory adjustment.");
  }
  const reason = requiredText(body.reason, "Reason", 500);
  const referenceKey = text(body.referenceKey, 255) || randomUUID();
  const rows = await database().query(
    `SELECT maxform_adjust_payment_inventory(
       $1::uuid, $2::uuid, $3::uuid, $4::integer, $5, $6
     ) AS quantity`,
    [userId, productId, variantId, adjustment, reason, referenceKey],
  );
  json(response, 200, { quantity: Number((rows[0] as RecordValue | undefined)?.quantity || 0) });
};

const acknowledgeInventoryAlert = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const alertId = requiredUuid(body.id, "Inventory alert");
  const rows = await database().query(
    `SELECT maxform_acknowledge_payment_inventory_alert($1::uuid, $2::uuid) AS updated`,
    [userId, alertId],
  );
  json(response, 200, { updated: Boolean((rows[0] as RecordValue | undefined)?.updated) });
};

const syncFormProduct = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const formId = requiredUuid(body.formId, "Form");
  const sql = database();
  const rows = await sql.query(
    `SELECT form.title, form.description, settings.payment
     FROM forms form
     JOIN form_settings settings ON settings.form_id = form.id
     WHERE form.id = $1 AND form.created_by = $2
     LIMIT 1`,
    [formId, userId],
  );
  if (rows.length !== 1) {
    throw new PaymentDataError("Form could not be found.", 404);
  }
  const form = rows[0] as RecordValue;
  const payment =
    form.payment && typeof form.payment === "object"
      ? (form.payment as RecordValue)
      : {};
  const enabled = payment.enabled === true;
  const mode = String(payment.mode || "");
  if (!enabled || mode !== "fixed") {
    await sql.query(
      `UPDATE payment_products
       SET active = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND source_type = 'form' AND source_id = $2`,
      [userId, formId],
    );
    json(response, 200, { synced: true });
    return;
  }
  const amount = money(payment.amount, "Amount");
  const paymentCurrency = currency(payment.currency);
  await sql.query(
    `INSERT INTO payment_products (
       user_id, name, description, price, currency, billing_type,
       source_type, source_id, active, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 'one_time', 'form', $6, TRUE, NOW(), NOW())
     ON CONFLICT (user_id, source_type, source_id)
       WHERE source_id IS NOT NULL
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       price = EXCLUDED.price,
       currency = EXCLUDED.currency,
       active = TRUE,
       updated_at = NOW()`,
    [
      userId,
      requiredText(form.title, "Form name", 160),
      text(form.description, 2000),
      amount,
      paymentCurrency,
      formId,
    ],
  );
  json(response, 200, { synced: true });
};

const validateImage = (value: unknown) => {
  const result = String(value || "");
  if (!result) return "";
  if (/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/i.test(result) && result.length <= 2048) {
    return result;
  }
  if (
    result.length > 2_500_000 ||
    !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\r\n]+$/i.test(result)
  ) {
    throw new PaymentDataError(
      "Upload a PNG, JPEG, or WebP image smaller than 2 MB.",
    );
  }
  return result;
};

const saveProduct = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const id = body.id ? requiredUuid(body.id, "Product") : null;
  const name = requiredText(body.name, "Product name", 160);
  const description = text(body.description, 2000);
  const shortDescription = text(body.shortDescription, 320);
  const sku = text(body.sku, 80).toUpperCase();
  if (sku && !/^[A-Z0-9._-]+$/.test(sku)) {
    throw new PaymentDataError(
      "SKU can only use letters, numbers, dots, dashes, and underscores.",
    );
  }
  const price = money(body.price, "Price");
  const salePrice =
    body.salePrice == null || body.salePrice === ""
      ? null
      : money(body.salePrice, "Sale price");
  if (salePrice != null && salePrice > price) {
    throw new PaymentDataError("Sale price cannot exceed the regular price.");
  }
  const productCurrency = currency(body.currency);
  const billingType =
    body.billingType === "recurring" ? "recurring" : "one_time";
  const interval = String(body.billingInterval || "");
  if (
    billingType === "recurring" &&
    !["week", "month", "quarter", "year"].includes(interval)
  ) {
    throw new PaymentDataError("Choose a valid billing interval.");
  }
  const imageUrl = validateImage(body.imageUrl);
  const imageGallery = Array.isArray(body.imageGallery)
    ? [...new Set(body.imageGallery.map((item) => validateImage(item)).filter(Boolean))].slice(0, 12)
    : [];
  const promotionalBanner = text(body.promotionalBanner, 80);
  const requestedCategories = Array.isArray(body.categories)
    ? body.categories
    : text(body.category, 240).split(",");
  const categories = [
    ...new Set(
      requestedCategories
        .map((item) => text(item, 60))
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
  const category = text(categories.join(", "), 240);
  const status = ["active", "draft", "hidden", "sold_out"].includes(
    String(body.status || "active"),
  )
    ? (String(body.status || "active") as "active" | "draft" | "hidden" | "sold_out")
    : "active";
  const availabilityStartAt = optionalDate(
    body.availabilityStartAt,
    "availability start",
  );
  const availabilityEndAt = optionalDate(
    body.availabilityEndAt,
    "availability end",
  );
  if (
    availabilityStartAt &&
    availabilityEndAt &&
    new Date(availabilityEndAt) <= new Date(availabilityStartAt)
  ) {
    throw new PaymentDataError("Availability end must be after the start.");
  }
  const onePerCustomer = boolean(body.onePerCustomer);
  const hideWhenSoldOut = boolean(body.hideWhenSoldOut);
  const active = boolean(body.active) && !["draft", "hidden"].includes(status);
  const taxable = boolean(body.taxable);
  const taxRate = money(body.taxRate || 0, "Tax rate");
  if (taxRate > 100) {
    throw new PaymentDataError("Tax rate cannot be more than 100%.");
  }
  const requiresShipping = boolean(body.requiresShipping);
  const trackInventory = boolean(body.trackInventory);
  const inventoryQuantity = Math.floor(Number(body.inventoryQuantity || 0));
  const allowBackorder = boolean(body.allowBackorder);
  const lowStockThreshold = Math.floor(Number(body.lowStockThreshold || 0));
  const weightGrams = Math.floor(Number(body.weightGrams || 0));
  if (
    !Number.isFinite(inventoryQuantity) || inventoryQuantity < 0 ||
    !Number.isFinite(lowStockThreshold) || lowStockThreshold < 0 ||
    !Number.isFinite(weightGrams) || weightGrams < 0
  ) {
    throw new PaymentDataError("Inventory and shipping values cannot be negative.");
  }
  const minQuantity = Math.floor(Number(body.minQuantity ?? 1));
  const maxQuantity = Math.floor(Number(body.maxQuantity ?? 1000));
  const zeroStockLimits =
    trackInventory && inventoryQuantity === 0 && minQuantity === 0 && maxQuantity === 0;
  if (
    (!zeroStockLimits &&
      (!Number.isInteger(minQuantity) ||
        minQuantity < 1 ||
        !Number.isInteger(maxQuantity) ||
        maxQuantity < minQuantity)) ||
    maxQuantity > 1000 ||
    (trackInventory && maxQuantity > inventoryQuantity)
  ) {
    throw new PaymentDataError(
      trackInventory
        ? "Maximum quantity cannot exceed the tracked stock quantity."
        : "Choose valid product quantity limits.",
    );
  }
  const options = Array.isArray(body.options)
    ? [...new Set(body.options.map((item) => text(item, 60)).filter(Boolean))].slice(0, 5)
    : [];
  const rawVariants = Array.isArray(body.variants) ? body.variants.slice(0, 100) : [];
  const variants = rawVariants.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new PaymentDataError(`Variant ${index + 1} is not valid.`);
    }
    const variant = item as RecordValue;
    const variantSku = text(variant.sku, 80).toUpperCase();
    if (variantSku && !/^[A-Z0-9._-]+$/.test(variantSku)) {
      throw new PaymentDataError(`Variant ${index + 1} has an invalid SKU.`);
    }
    const optionValues =
      variant.optionValues && typeof variant.optionValues === "object" &&
      !Array.isArray(variant.optionValues)
        ? Object.fromEntries(
            Object.entries(variant.optionValues as RecordValue)
              .map(([key, value]) => [text(key, 60), text(value, 100)])
              .filter(([key, value]) => Boolean(key && value))
              .slice(0, 10),
          )
        : {};
    const variantInventory = Math.floor(Number(variant.inventoryQuantity || 0));
    const variantLowStock = Math.floor(Number(variant.lowStockThreshold || 0));
    const variantPrice = money(variant.price, `Variant ${index + 1} price`);
    const variantSalePrice =
      variant.salePrice == null || variant.salePrice === ""
        ? null
        : money(variant.salePrice, `Variant ${index + 1} sale price`);
    if (variantSalePrice != null && variantSalePrice > variantPrice) {
      throw new PaymentDataError(
        `Variant ${index + 1} sale price cannot exceed its regular price.`,
      );
    }
    if (
      !Number.isFinite(variantInventory) || variantInventory < 0 ||
      !Number.isFinite(variantLowStock) || variantLowStock < 0
    ) {
      throw new PaymentDataError(`Variant ${index + 1} has invalid inventory.`);
    }
    return {
      id: variant.id ? requiredUuid(variant.id, `Variant ${index + 1}`) : randomUUID(),
      name: requiredText(variant.name, `Variant ${index + 1} name`, 160),
      sku: variantSku,
      price: variantPrice,
      salePrice: variantSalePrice,
      description: text(variant.description, 500),
      optionValues,
      imageUrl: validateImage(variant.imageUrl),
      trackInventory: boolean(variant.trackInventory),
      inventoryQuantity: variantInventory,
      lowStockThreshold: variantLowStock,
      allowBackorder: boolean(variant.allowBackorder),
      weightGrams: Math.max(0, Math.floor(Number(variant.weightGrams || 0))),
      availabilityStartAt: optionalDate(
        variant.availabilityStartAt,
        `variant ${index + 1} availability start`,
      ),
      availabilityEndAt: optionalDate(
        variant.availabilityEndAt,
        `variant ${index + 1} availability end`,
      ),
      active: variant.active !== false,
      sortOrder: index,
    };
  });
  const uniqueVariantSkus = variants.map((variant) => variant.sku).filter(Boolean);
  if (new Set(uniqueVariantSkus).size !== uniqueVariantSkus.length) {
    throw new PaymentDataError("Each product variant must use a unique SKU.");
  }
  const sql = database();
  const rows = id
    ? await sql.query(
        `UPDATE payment_products
         SET name = $1, description = $2, short_description = $3, sku = $4,
             price = $5, sale_price = $6, currency = $7, billing_type = $8,
             billing_interval = $9, image_url = $10, image_gallery = $11::jsonb,
             promotional_banner = $12, category = $13, product_status = $14,
             availability_start_at = $15, availability_end_at = $16,
             min_quantity = $17, max_quantity = $18, one_per_customer = $19,
             hide_when_sold_out = $20, active = $21, taxable = $22, tax_rate = $23,
             requires_shipping = $24, track_inventory = $25,
             low_stock_threshold = $26, allow_backorder = $27,
             weight_grams = $28, options = $29::jsonb,
             updated_at = NOW()
         WHERE id = $30 AND user_id = $31 AND source_type = 'catalog'
         RETURNING id`,
        [
          name,
          description,
          shortDescription,
          sku,
          price,
          salePrice,
          productCurrency,
          billingType,
          billingType === "recurring" ? interval : null,
          imageUrl,
          JSON.stringify(imageGallery),
          promotionalBanner,
          category,
          status,
          availabilityStartAt,
          availabilityEndAt,
          minQuantity,
          maxQuantity,
          onePerCustomer,
          hideWhenSoldOut,
          active,
          taxable,
          taxRate,
          requiresShipping,
          trackInventory,
          lowStockThreshold,
          allowBackorder,
          weightGrams,
          JSON.stringify(options),
          id,
          userId,
        ],
      )
    : await sql.query(
        `INSERT INTO payment_products (
           user_id, name, description, short_description, sku, price, sale_price,
           currency, billing_type, billing_interval, source_type, image_url,
           image_gallery, promotional_banner, category, product_status,
           availability_start_at, availability_end_at, min_quantity, max_quantity,
           one_per_customer, hide_when_sold_out, active, taxable, tax_rate,
           requires_shipping, track_inventory, inventory_quantity,
           low_stock_threshold, allow_backorder, weight_grams, options
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'catalog', $11,
           $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
           $23, $24, $25, $26, $27, $28, $29, $30, $31::jsonb)
         RETURNING id`,
        [
          userId,
          name,
          description,
          shortDescription,
          sku,
          price,
          salePrice,
          productCurrency,
          billingType,
          billingType === "recurring" ? interval : null,
          imageUrl,
          JSON.stringify(imageGallery),
          promotionalBanner,
          category,
          status,
          availabilityStartAt,
          availabilityEndAt,
          minQuantity,
          maxQuantity,
          onePerCustomer,
          hideWhenSoldOut,
          active,
          taxable,
          taxRate,
          requiresShipping,
          trackInventory,
          0,
          lowStockThreshold,
          allowBackorder,
          weightGrams,
          JSON.stringify(options),
        ],
      );
  if (!rows[0]) throw new PaymentDataError("Product could not be saved.", 404);
  const productId = String((rows[0] as RecordValue).id);
  if (trackInventory) {
    await sql.query(
      `SELECT maxform_set_payment_inventory(
         $1::uuid, $2::uuid, NULL::uuid, $3::integer, $4, $5
       ) AS quantity`,
      [
        userId,
        productId,
        inventoryQuantity,
        "Product editor stock update",
        `product-save:${productId}:${randomUUID()}`,
      ],
    );
  }
  for (const variant of variants) {
    const saved = await sql.query(
      `INSERT INTO payment_product_variants (
         id, product_id, name, sku, price, sale_price, description,
         option_values, image_url,
         track_inventory, inventory_quantity, low_stock_threshold,
         allow_backorder, weight_grams, availability_start_at,
         availability_end_at, active, sort_order, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, NOW(), NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, sku = EXCLUDED.sku, price = EXCLUDED.price,
         sale_price = EXCLUDED.sale_price, description = EXCLUDED.description,
         option_values = EXCLUDED.option_values, image_url = EXCLUDED.image_url,
         track_inventory = EXCLUDED.track_inventory,
         low_stock_threshold = EXCLUDED.low_stock_threshold,
         allow_backorder = EXCLUDED.allow_backorder,
         weight_grams = EXCLUDED.weight_grams,
         availability_start_at = EXCLUDED.availability_start_at,
         availability_end_at = EXCLUDED.availability_end_at,
         active = EXCLUDED.active,
         sort_order = EXCLUDED.sort_order, updated_at = NOW()
       WHERE payment_product_variants.product_id = EXCLUDED.product_id
       RETURNING id`,
      [
        variant.id, productId, variant.name, variant.sku, variant.price,
        variant.salePrice, variant.description,
        JSON.stringify(variant.optionValues), variant.imageUrl,
        variant.trackInventory, 0,
        variant.lowStockThreshold, variant.allowBackorder, variant.weightGrams,
        variant.availabilityStartAt, variant.availabilityEndAt,
        variant.active, variant.sortOrder,
      ],
    );
    if (!saved[0]) {
      throw new PaymentDataError("A product variant could not be saved.", 409);
    }
    if (variant.trackInventory) {
      await sql.query(
        `SELECT maxform_set_payment_inventory(
           $1::uuid, $2::uuid, $3::uuid, $4::integer, $5, $6
         ) AS quantity`,
        [
          userId,
          productId,
          variant.id,
          variant.inventoryQuantity,
          "Product editor variant stock update",
          `variant-save:${variant.id}:${randomUUID()}`,
        ],
      );
    }
  }
  if (variants.length) {
    await sql.query(
      `DELETE FROM payment_product_variants
       WHERE product_id = $1 AND NOT (id = ANY($2::uuid[]))`,
      [productId, variants.map((variant) => variant.id)],
    );
  } else {
    await sql.query(`DELETE FROM payment_product_variants WHERE product_id = $1`, [productId]);
  }
  const productRows = await sql.query(
    `SELECT ${productSelectColumns}
     FROM payment_products
     WHERE payment_products.id = $1 AND payment_products.user_id = $2`,
    [productId, userId],
  );
  json(response, 200, { row: productRows[0] });
};

const toggleProduct = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const id = requiredUuid(body.id, "Product");
  const sql = database();
  const rows = await sql.query(
    `UPDATE payment_products
     SET active = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3 AND source_type = 'catalog'
     RETURNING id`,
    [boolean(body.active), id, userId],
  );
  if (!rows[0]) throw new PaymentDataError("Product could not be found.", 404);
  json(response, 200, { updated: true });
};

const syncTicketProduct = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const ticketTypeId = requiredUuid(body.ticketTypeId, "Ticket type");
  const sql = database();
  const rows = await sql.query(
    `INSERT INTO payment_products (
       user_id, name, description, price, currency, billing_type,
       source_type, source_id, active, created_at, updated_at
     )
     SELECT event.created_by,
       event.title || ' - ' || ticket_type.name,
       ticket_type.description, ticket_type.price, ticket_type.currency,
       'one_time', 'ticket_type', ticket_type.id, ticket_type.active,
       NOW(), NOW()
     FROM event_ticket_types ticket_type
     JOIN events event ON event.id = ticket_type.event_id
     WHERE ticket_type.id = $1 AND event.created_by = $2
     ON CONFLICT (user_id, source_type, source_id)
       WHERE source_id IS NOT NULL
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       price = EXCLUDED.price,
       currency = EXCLUDED.currency,
       active = EXCLUDED.active,
       updated_at = NOW()
     RETURNING id`,
    [ticketTypeId, userId],
  );
  if (!rows[0]) {
    throw new PaymentDataError("Ticket type could not be found.", 404);
  }
  await sql.query(
    `UPDATE event_ticket_types
     SET product_id = $1, updated_at = NOW()
     WHERE id = $2
       AND EXISTS (
         SELECT 1 FROM events
         WHERE events.id = event_ticket_types.event_id
           AND events.created_by = $3
       )`,
    [rows[0].id, ticketTypeId, userId],
  );
  json(response, 200, { synced: true });
};

const deactivateTicketProduct = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const ticketTypeId = requiredUuid(body.ticketTypeId, "Ticket type");
  const sql = database();
  await sql.query(
    `UPDATE payment_products
     SET active = FALSE, updated_at = NOW()
     WHERE user_id = $1
       AND source_type = 'ticket_type'
       AND source_id = $2`,
    [userId, ticketTypeId],
  );
  json(response, 200, { updated: true });
};

const saveCoupon = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const id = body.id ? requiredUuid(body.id, "Coupon") : null;
  const code = requiredText(body.code, "Coupon code", 40).toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) {
    throw new PaymentDataError(
      "Coupon code can only use letters, numbers, dashes, and underscores.",
    );
  }
  const name = requiredText(body.name, "Coupon name", 120);
  const description = text(body.description, 500);
  const discountType =
    body.discountType === "fixed" ? "fixed" : "percentage";
  const discountValue = money(body.discountValue, "Discount", false);
  if (discountType === "percentage" && discountValue > 100) {
    throw new PaymentDataError("Percentage discounts cannot exceed 100%.");
  }
  const couponCurrency =
    discountType === "fixed" ? currency(body.currency || "USD") : null;
  const limitValue =
    body.redemptionLimit == null || body.redemptionLimit === ""
      ? null
      : Number(body.redemptionLimit);
  if (
    limitValue != null &&
    (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 10_000_000)
  ) {
    throw new PaymentDataError("Enter a valid redemption limit.");
  }
  const customerLimitValue =
    body.redemptionLimitPerCustomer == null ||
    body.redemptionLimitPerCustomer === ""
      ? null
      : Number(body.redemptionLimitPerCustomer);
  if (
    customerLimitValue != null &&
    (!Number.isInteger(customerLimitValue) ||
      customerLimitValue < 1 ||
      customerLimitValue > 10_000_000)
  ) {
    throw new PaymentDataError("Enter a valid per-customer limit.");
  }
  const identityLimitValue =
    body.redemptionLimitPerIdentity == null ||
    body.redemptionLimitPerIdentity === ""
      ? null
      : Number(body.redemptionLimitPerIdentity);
  if (
    identityLimitValue != null &&
    (!Number.isInteger(identityLimitValue) ||
      identityLimitValue < 1 ||
      identityLimitValue > 10_000_000)
  ) {
    throw new PaymentDataError("Enter a valid per-IP/device limit.");
  }
  const minimumAmount = money(body.minimumAmount, "Minimum amount");
  const maximumDiscount =
    body.maximumDiscount == null || body.maximumDiscount === ""
      ? null
      : money(body.maximumDiscount, "Maximum discount", false);
  if (discountType === "fixed" && maximumDiscount != null) {
    throw new PaymentDataError(
      "A maximum discount only applies to percentage coupons.",
    );
  }
  const normalizeProductIds = async (value: unknown, label: string) => {
    if (value == null) return [] as string[];
    if (!Array.isArray(value) || value.length > 100) {
      throw new PaymentDataError(`Choose no more than 100 ${label.toLowerCase()}.`);
    }
    const ids = [...new Set(value.map((item) => requiredUuid(item, label)))];
    if (ids.length) {
      const owned = await database().query(
        `SELECT COUNT(*)::int AS count
         FROM payment_products
         WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, ids],
      );
      if (Number((owned[0] as RecordValue | undefined)?.count || 0) !== ids.length) {
        throw new PaymentDataError(`One or more ${label.toLowerCase()} are unavailable.`, 409);
      }
    }
    return ids;
  };
  const eligibleProductIds = await normalizeProductIds(
    body.eligibleProductIds,
    "Eligible product",
  );
  const excludedProductIds = await normalizeProductIds(
    body.excludedProductIds,
    "Excluded product",
  );
  if (eligibleProductIds.some((id) => excludedProductIds.includes(id))) {
    throw new PaymentDataError("A product cannot be both eligible and excluded.");
  }
  const rawTargets = Array.isArray(body.appliesTo) ? body.appliesTo : [];
  if (rawTargets.length > 100) {
    throw new PaymentDataError("Choose no more than 100 coupon targets.");
  }
  const appliesTo = rawTargets.map((value) => couponTarget(value, "Coupon target"));
  const uniqueTargets = Array.from(
    new Map(
      appliesTo.map((target) => [`${target.type}:${target.id}`, target]),
    ).values(),
  );
  const hasDirectTarget = Object.prototype.hasOwnProperty.call(
    body,
    "directTarget",
  );
  const directTarget = hasDirectTarget
    ? couponTarget(body.directTarget, "Direct coupon target")
    : null;
  if (
    directTarget &&
    (uniqueTargets.length !== 1 ||
      uniqueTargets[0].id !== directTarget.id ||
      uniqueTargets[0].type !== directTarget.type)
  ) {
    throw new PaymentDataError(
      "A direct coupon must be linked only to the form or event where it was created.",
    );
  }
  if (uniqueTargets.length) {
    const eligible = await eligibleCouponTargets(userId);
    const targetAvailability = new Map(
      eligible.map((target) => [
        `${String(target.type)}:${String(target.id)}`,
        target.coupons_enabled === true,
      ]),
    );
    if (
      uniqueTargets.some(
        (target) =>
          !targetAvailability.has(`${target.type}:${target.id}`),
      )
    ) {
      throw new PaymentDataError(
        "One of the selected checkouts is no longer eligible for coupons.",
        409,
      );
    }
    if (
      uniqueTargets.some(
        (target) =>
          targetAvailability.get(`${target.type}:${target.id}`) !== true,
      )
    ) {
      throw new PaymentDataError(
        "Turn on coupons in this form or event builder before assigning a coupon.",
        409,
        "coupon_target_disabled",
      );
    }
  }
  const startsAt = optionalDate(body.startsAt, "Start date");
  const endsAt = optionalDate(body.endsAt, "End date");
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new PaymentDataError("End date must be after the start date.");
  }
  const couponValues = [
    code,
    name,
    description,
    discountType,
    discountValue,
    couponCurrency,
    limitValue,
    customerLimitValue,
    identityLimitValue,
    minimumAmount,
    maximumDiscount,
    JSON.stringify(uniqueTargets),
    JSON.stringify(eligibleProductIds),
    JSON.stringify(excludedProductIds),
    startsAt,
    endsAt,
    boolean(body.active),
  ];
  const sql = database();
  const rows = id
    ? await sql.query(
        `UPDATE payment_coupons
         SET code = $1, name = $2, description = $3, discount_type = $4,
             discount_value = $5, currency = $6, redemption_limit = $7,
             redemption_limit_per_customer = $8,
             redemption_limit_per_identity = $9, minimum_amount = $10,
             maximum_discount = $11, applies_to = $12::jsonb,
             eligible_product_ids = $13::jsonb, excluded_product_ids = $14::jsonb,
             starts_at = $15, ends_at = $16, active = $17,
             direct_target = CASE
               WHEN $18::boolean THEN $19::jsonb
               ELSE direct_target
             END,
             updated_at = NOW()
         WHERE id = $20 AND user_id = $21
         RETURNING id, code, name, description, discount_type, discount_value, currency,
                   redemption_limit, redemption_limit_per_customer,
                   redemption_limit_per_identity,
                   redemption_count, minimum_amount, maximum_discount,
                   applies_to, eligible_product_ids, excluded_product_ids,
                   direct_target, starts_at, ends_at, active, created_at, updated_at`,
        [
          ...couponValues,
          hasDirectTarget,
          JSON.stringify(directTarget),
          id,
          userId,
        ],
      )
    : await sql.query(
        `INSERT INTO payment_coupons (
           user_id, code, name, description, discount_type, discount_value, currency,
           redemption_limit, redemption_limit_per_customer,
           redemption_limit_per_identity, minimum_amount, maximum_discount, applies_to,
           eligible_product_ids, excluded_product_ids, starts_at, ends_at, active,
           direct_target
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13::jsonb, $14::jsonb, $15::jsonb, $16, $17, $18, $19::jsonb
         )
         RETURNING id, code, name, description, discount_type, discount_value, currency,
                   redemption_limit, redemption_limit_per_customer,
                   redemption_limit_per_identity,
                   redemption_count, minimum_amount, maximum_discount,
                   applies_to, eligible_product_ids, excluded_product_ids,
                   direct_target, starts_at, ends_at, active, created_at, updated_at`,
        [userId, ...couponValues, JSON.stringify(directTarget)],
      );
  if (!rows[0]) throw new PaymentDataError("Coupon could not be saved.", 404);
  json(response, 200, { row: rows[0] });
};

const toggleCoupon = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const id = requiredUuid(body.id, "Coupon");
  const sql = database();
  const rows = await sql.query(
    `UPDATE payment_coupons
     SET active = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING id`,
    [boolean(body.active), id, userId],
  );
  if (!rows[0]) throw new PaymentDataError("Coupon could not be found.", 404);
  json(response, 200, { updated: true });
};

const deleteCoupon = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const id = requiredUuid(body.id, "Coupon");
  const sql = database();
  const rows = await sql.query(
    `DELETE FROM payment_coupons
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [id, userId],
  );
  if (!rows[0]) throw new PaymentDataError("Coupon could not be found.", 404);
  json(response, 200, { deleted: true });
};

const couponAnalytics = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const id = requiredUuid(body.id, "Coupon");
  const sql = database();
  const coupon = await sql.query(
    `SELECT id
     FROM payment_coupons
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [id, userId],
  );
  if (!coupon[0]) throw new PaymentDataError("Coupon could not be found.", 404);

  const [summaryRows, totalRows, redemptionRows] = await Promise.all([
    sql.query(
      `SELECT
         COUNT(*) FILTER (WHERE redemption.status = 'redeemed')::integer
           AS redeemed_count,
         COUNT(*) FILTER (
           WHERE redemption.status = 'reserved'
             AND (redemption.expires_at IS NULL OR redemption.expires_at > NOW())
         )::integer
           AS reserved_count,
         COUNT(*) FILTER (WHERE redemption.status = 'released')::integer
           AS released_count,
         COUNT(DISTINCT NULLIF(LOWER(TRIM(payment_order.customer_email)), ''))
           FILTER (WHERE redemption.status = 'redeemed')::integer
           AS unique_customers
       FROM payment_coupon_redemptions redemption
       JOIN payment_orders payment_order ON payment_order.id = redemption.order_id
       WHERE redemption.coupon_id = $1
         AND payment_order.user_id = $2`,
      [id, userId],
    ),
    sql.query(
      `SELECT payment_order.currency,
         COUNT(*)::integer AS redemptions,
         COALESCE(SUM(payment_order.discount_amount), 0) AS discount_amount,
         COALESCE(SUM(payment_order.total_amount), 0) AS revenue_after_discount
       FROM payment_coupon_redemptions redemption
       JOIN payment_orders payment_order ON payment_order.id = redemption.order_id
       WHERE redemption.coupon_id = $1
         AND payment_order.user_id = $2
         AND redemption.status = 'redeemed'
       GROUP BY payment_order.currency
       ORDER BY payment_order.currency`,
      [id, userId],
    ),
    sql.query(
      `SELECT redemption.status, redemption.created_at, redemption.redeemed_at,
         payment_order.order_number, payment_order.customer_name,
         payment_order.customer_email, payment_order.discount_amount,
         payment_order.total_amount, payment_order.currency,
         COALESCE(form.title, event.title, payment_order.order_number) AS source_name
       FROM payment_coupon_redemptions redemption
       JOIN payment_orders payment_order ON payment_order.id = redemption.order_id
       LEFT JOIN forms form
         ON payment_order.source_type = 'form'
        AND form.id = payment_order.source_id
       LEFT JOIN events event
         ON payment_order.source_type = 'event'
        AND event.id = payment_order.source_id
       WHERE redemption.coupon_id = $1
         AND payment_order.user_id = $2
       ORDER BY COALESCE(redemption.redeemed_at, redemption.created_at) DESC
       LIMIT 50`,
      [id, userId],
    ),
  ]);
  const summary = (summaryRows[0] || {}) as RecordValue;
  json(response, 200, {
    couponId: id,
    redeemedCount: Number(summary.redeemed_count || 0),
    reservedCount: Number(summary.reserved_count || 0),
    releasedCount: Number(summary.released_count || 0),
    uniqueCustomers: Number(summary.unique_customers || 0),
    totals: totalRows.map((row) => {
      const total = row as RecordValue;
      return {
        currency: String(total.currency || "USD"),
        discountAmount: Number(total.discount_amount || 0),
        revenueAfterDiscount: Number(total.revenue_after_discount || 0),
        redemptions: Number(total.redemptions || 0),
      };
    }),
    recentRedemptions: redemptionRows.map((row) => {
      const redemption = row as RecordValue;
      return {
        createdAt: String(redemption.created_at || ""),
        currency: String(redemption.currency || "USD"),
        customerEmail: String(redemption.customer_email || ""),
        customerName: String(redemption.customer_name || ""),
        discountAmount: Number(redemption.discount_amount || 0),
        orderNumber: String(redemption.order_number || ""),
        redeemedAt: String(redemption.redeemed_at || ""),
        sourceName: String(redemption.source_name || ""),
        status: String(redemption.status || "reserved"),
        totalAmount: Number(redemption.total_amount || 0),
      };
    }),
  });
};

type InvoiceLine = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

const invoiceLines = (value: unknown): InvoiceLine[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new PaymentDataError("Add at least one invoice item.");
  }
  return value.map((item, index) => {
    const row =
      item && typeof item === "object" ? (item as RecordValue) : {};
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) {
      throw new PaymentDataError(
        `Enter a valid quantity for invoice item ${index + 1}.`,
      );
    }
    return {
      id: isUuid(String(row.id || "")) ? String(row.id) : randomUUID(),
      name: requiredText(row.name, `Invoice item ${index + 1}`, 160),
      quantity,
      unitPrice: money(row.unitPrice, `Invoice item ${index + 1} price`),
    };
  });
};

const saveInvoice = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const id = body.id ? requiredUuid(body.id, "Invoice") : null;
  const customerName = requiredText(body.customerName, "Customer name", 160);
  const customerEmail = requiredText(
    body.customerEmail,
    "Customer email",
    254,
  ).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new PaymentDataError("Enter a valid customer email.");
  }
  const lines = invoiceLines(body.lineItems);
  const amountDue = Math.round(
    lines.reduce(
      (total, line) => total + line.quantity * line.unitPrice * 100,
      0,
    ),
  ) / 100;
  const invoiceCurrency = currency(body.currency);
  const dueAt = optionalDate(body.dueAt, "Due date");
  const memo = text(body.memo, 2000);
  const sql = database();
  const rows = id
    ? await sql.query(
        `UPDATE payment_invoices
         SET customer_name = $1, customer_email = $2, amount_due = $3,
             currency = $4, due_at = $5, memo = $6, line_items = $7::jsonb,
             updated_at = NOW()
         WHERE id = $8 AND user_id = $9 AND status IN ('draft', 'open')
         RETURNING id, order_id, invoice_number, customer_name,
                   customer_email, status, amount_due, amount_paid, currency,
                   due_at, sent_at, paid_at, memo, line_items, created_at,
                   updated_at`,
        [
          customerName,
          customerEmail,
          amountDue,
          invoiceCurrency,
          dueAt,
          memo,
          JSON.stringify(lines),
          id,
          userId,
        ],
      )
    : await sql.query(
        `INSERT INTO payment_invoices (
           user_id, invoice_number, customer_name, customer_email, amount_due,
           currency, due_at, memo, line_items
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING id, order_id, invoice_number, customer_name,
                   customer_email, status, amount_due, amount_paid, currency,
                   due_at, sent_at, paid_at, memo, line_items, created_at,
                   updated_at`,
        [
          userId,
          `INV-${Date.now().toString(36).toUpperCase()}-${randomUUID()
            .slice(0, 4)
            .toUpperCase()}`,
          customerName,
          customerEmail,
          amountDue,
          invoiceCurrency,
          dueAt,
          memo,
          JSON.stringify(lines),
        ],
      );
  if (!rows[0]) {
    throw new PaymentDataError(
      "Only draft or open invoices can be edited.",
      409,
    );
  }
  json(response, 200, { row: rows[0] });
};

const updateInvoiceStatus = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const id = requiredUuid(body.id, "Invoice");
  const status = String(body.status || "");
  if (!["draft", "open", "paid", "overdue", "void"].includes(status)) {
    throw new PaymentDataError("Choose a valid invoice status.");
  }
  const sql = database();
  const orderId = randomUUID();
  const rows = await sql.query(
    `WITH current_invoice AS (
       SELECT *
       FROM payment_invoices
       WHERE id = $2 AND user_id = $3
       LIMIT 1
     ),
     saved_order AS (
       INSERT INTO payment_orders (
         id, user_id, order_number, source_type, source_id, customer_name,
         customer_email, status, provider, subtotal, total_amount, currency,
         paid_at, metadata, created_at, updated_at
       )
       SELECT $4, current_invoice.user_id,
         'MANUAL-' || current_invoice.invoice_number,
         'invoice', current_invoice.id, current_invoice.customer_name,
         current_invoice.customer_email, 'paid', NULL,
         current_invoice.amount_due, current_invoice.amount_due,
         current_invoice.currency, NOW(),
         jsonb_build_object('invoiceId', current_invoice.id), NOW(), NOW()
       FROM current_invoice
       WHERE $1 = 'paid' AND current_invoice.order_id IS NULL
       ON CONFLICT (user_id, order_number) DO NOTHING
       RETURNING id
     ),
     resolved_order AS (
       SELECT id FROM saved_order
       UNION ALL
       SELECT current_invoice.order_id
       FROM current_invoice
       WHERE current_invoice.order_id IS NOT NULL
       UNION ALL
       SELECT payment_order.id
       FROM current_invoice
       JOIN payment_orders payment_order
         ON payment_order.user_id = current_invoice.user_id
        AND payment_order.order_number =
          'MANUAL-' || current_invoice.invoice_number
       LIMIT 1
     ),
     saved_items AS (
       INSERT INTO payment_order_items (
         order_id, product_id, name, description, quantity, unit_price,
         total_amount, created_at
       )
       SELECT saved_order.id, NULL, item.value->>'name', '',
         (item.value->>'quantity')::integer,
         (item.value->>'unitPrice')::numeric,
         (item.value->>'quantity')::integer *
           (item.value->>'unitPrice')::numeric,
         NOW()
       FROM saved_order
       CROSS JOIN current_invoice
       CROSS JOIN LATERAL jsonb_array_elements(
         current_invoice.line_items
       ) item(value)
       RETURNING id
     )
     UPDATE payment_invoices invoice
     SET status = $1,
         order_id = CASE
           WHEN $1 = 'paid'
             THEN COALESCE(invoice.order_id, (SELECT id FROM resolved_order))
           ELSE invoice.order_id
         END,
         sent_at = CASE
           WHEN $1 = 'open' AND invoice.sent_at IS NULL THEN NOW()
           ELSE invoice.sent_at
         END,
         paid_at = CASE
           WHEN $1 = 'paid' THEN COALESCE(invoice.paid_at, NOW())
           ELSE invoice.paid_at
         END,
         amount_paid = CASE
           WHEN $1 = 'paid' THEN invoice.amount_due
           ELSE invoice.amount_paid
         END,
         updated_at = NOW()
     WHERE invoice.id = $2 AND invoice.user_id = $3
     RETURNING invoice.id, invoice.order_id, invoice.invoice_number,
               invoice.customer_name, invoice.customer_email, invoice.status,
               invoice.amount_due, invoice.amount_paid, invoice.currency,
               invoice.due_at, invoice.sent_at, invoice.paid_at, invoice.memo,
               invoice.line_items, invoice.created_at, invoice.updated_at`,
    [status, id, userId, orderId],
  );
  if (!rows[0]) throw new PaymentDataError("Invoice could not be found.", 404);
  if (status === "paid" && rows[0].order_id) {
    await syncPaidOrderToCrm(String(rows[0].order_id));
  }
  json(response, 200, { row: rows[0] });
};

const setDefaultProvider = async (
  response: ServerResponse,
  userId: string,
  body: RecordValue,
) => {
  const id = requiredUuid(body.id, "Payment provider");
  const sql = database();
  const rows = await sql.query(
    `WITH target AS (
       SELECT id
       FROM payment_provider_connections
       WHERE id = $2
         AND user_id = $1
         AND status = 'connected'
         AND health_ok = TRUE
     ),
     cleared AS (
       UPDATE payment_provider_connections
       SET is_default = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND EXISTS (SELECT 1 FROM target)
       RETURNING id
     )
     UPDATE payment_provider_connections
     SET is_default = TRUE, updated_at = NOW()
     WHERE id IN (SELECT id FROM target)
     RETURNING id`,
    [userId, id],
  );
  if (!rows[0]) {
    throw new PaymentDataError(
      "Connect and verify this provider before making it the default.",
      409,
    );
  }
  json(response, 200, { updated: true });
};

export async function handlePaymentData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "workspace";
    const userId = await authenticatedUserId(request);

    if (request.method === "GET") {
      if (action === "connections") {
        await listConnections(response, userId, true);
        return;
      }
      if (action === "products") {
        await listProducts(response, userId);
        return;
      }
      if (action === "has-provider") {
        await hasProvider(response, userId, url);
        return;
      }
      if (action === "workspace") {
        await listWorkspace(response, userId);
        return;
      }
      if (action === "form-payments") {
        await listFormPayments(response, userId, url);
        return;
      }
      if (action === "contact-payments") {
        await listContactPayments(response, userId, url);
        return;
      }
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      if (action === "sync-form-product") {
        await syncFormProduct(response, userId, body);
        return;
      }
      if (action === "save-product") {
        await saveProduct(response, userId, body);
        return;
      }
      if (action === "toggle-product") {
        await toggleProduct(response, userId, body);
        return;
      }
      if (action === "sync-ticket-product") {
        await syncTicketProduct(response, userId, body);
        return;
      }
      if (action === "deactivate-ticket-product") {
        await deactivateTicketProduct(response, userId, body);
        return;
      }
      if (action === "save-coupon") {
        await saveCoupon(response, userId, body);
        return;
      }
      if (action === "toggle-coupon") {
        await toggleCoupon(response, userId, body);
        return;
      }
      if (action === "delete-coupon") {
        await deleteCoupon(response, userId, body);
        return;
      }
      if (action === "coupon-analytics") {
        await couponAnalytics(response, userId, body);
        return;
      }
      if (action === "save-invoice") {
        await saveInvoice(response, userId, body);
        return;
      }
      if (action === "update-invoice") {
        await updateInvoiceStatus(response, userId, body);
        return;
      }
      if (action === "default-provider") {
        await setDefaultProvider(response, userId, body);
        return;
      }
      if (action === "adjust-inventory") {
        await adjustInventory(response, userId, body);
        return;
      }
      if (action === "ack-inventory-alert") {
        await acknowledgeInventoryAlert(response, userId, body);
        return;
      }
    }

    json(response, 404, { error: "This payment action is not available." });
  } catch (error) {
    if (error instanceof PaymentDataError) {
      json(response, error.status, { error: error.message, code: error.code });
      return;
    }
    const databaseCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    if (databaseCode === "23505") {
      json(response, 409, {
        error: "That value is already in use. Choose another and try again.",
        code: "payment_conflict",
      });
      return;
    }
    console.error("[payment-data] unexpected request failure", {
      code: databaseCode || "unknown",
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      error: "Payments could not be updated right now. Please try again.",
      code: "payment_data_error",
    });
  }
}

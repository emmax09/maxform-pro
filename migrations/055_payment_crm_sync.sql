-- Backfill historical paid orders into Contacts and the unified CRM timeline.

INSERT INTO payment_orders (
  id, user_id, order_number, source_type, source_id, customer_name,
  customer_email, status, provider, subtotal, total_amount, currency,
  paid_at, metadata, created_at, updated_at
)
SELECT gen_random_uuid(), invoice.user_id,
  'MANUAL-' || invoice.invoice_number, 'invoice', invoice.id,
  invoice.customer_name, invoice.customer_email, 'paid', NULL,
  invoice.amount_due, invoice.amount_due, invoice.currency,
  COALESCE(invoice.paid_at, invoice.updated_at),
  jsonb_build_object('invoiceId', invoice.id),
  invoice.created_at, invoice.updated_at
FROM payment_invoices invoice
WHERE invoice.status = 'paid'
  AND invoice.order_id IS NULL
ON CONFLICT (user_id, order_number) DO NOTHING;

UPDATE payment_invoices invoice
SET order_id = payment_order.id,
    updated_at = NOW()
FROM payment_orders payment_order
WHERE invoice.user_id = payment_order.user_id
  AND payment_order.order_number = 'MANUAL-' || invoice.invoice_number
  AND invoice.status = 'paid'
  AND invoice.order_id IS NULL;

INSERT INTO payment_order_items (
  order_id, product_id, name, description, quantity, unit_price,
  total_amount, created_at
)
SELECT payment_order.id, NULL, item.value->>'name', '',
  (item.value->>'quantity')::integer,
  (item.value->>'unitPrice')::numeric,
  (item.value->>'quantity')::integer *
    (item.value->>'unitPrice')::numeric,
  payment_order.created_at
FROM payment_orders payment_order
JOIN payment_invoices invoice
  ON invoice.id = payment_order.source_id
 AND payment_order.source_type = 'invoice'
CROSS JOIN LATERAL jsonb_array_elements(invoice.line_items) item(value)
WHERE NOT EXISTS (
  SELECT 1
  FROM payment_order_items existing_item
  WHERE existing_item.order_id = payment_order.id
);

WITH paid_customer AS (
  SELECT DISTINCT ON (
    payment_order.user_id,
    LOWER(TRIM(payment_order.customer_email))
  )
    payment_order.id,
    payment_order.user_id,
    payment_order.customer_name,
    LOWER(TRIM(payment_order.customer_email)) AS normalized_email,
    NULLIF(
      TRIM(COALESCE(
        payment_order.metadata #>> '{checkoutCustomer,phone}',
        ''
      )),
      ''
    ) AS phone,
    COALESCE(payment_order.paid_at, payment_order.created_at) AS activity_at
  FROM payment_orders payment_order
  WHERE payment_order.status IN ('paid', 'partially_refunded', 'refunded')
    AND LENGTH(TRIM(payment_order.customer_email)) BETWEEN 3 AND 254
    AND LOWER(TRIM(payment_order.customer_email)) LIKE '%_@_%._%'
  ORDER BY
    payment_order.user_id,
    LOWER(TRIM(payment_order.customer_email)),
    COALESCE(payment_order.paid_at, payment_order.created_at) DESC
)
INSERT INTO contacts (
  email, full_name, phone, tags, custom_fields, created_by,
  lifecycle_stage, source_type, source_id, last_activity_at,
  created_at, updated_at
)
SELECT paid_customer.normalized_email,
  NULLIF(TRIM(paid_customer.customer_name), ''),
  paid_customer.phone, '[]'::jsonb, '{}'::jsonb, paid_customer.user_id,
  'customer', 'payment', paid_customer.id, paid_customer.activity_at,
  NOW(), NOW()
FROM paid_customer
ON CONFLICT (created_by, LOWER(email))
DO UPDATE SET
  full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), contacts.full_name),
  phone = COALESCE(NULLIF(EXCLUDED.phone, ''), contacts.phone),
  lifecycle_stage = 'customer',
  source_type = CASE
    WHEN contacts.source_type = 'manual' THEN 'payment'
    ELSE contacts.source_type
  END,
  source_id = CASE
    WHEN contacts.source_type = 'manual' THEN EXCLUDED.source_id
    ELSE contacts.source_id
  END,
  last_activity_at = GREATEST(
    COALESCE(contacts.last_activity_at, EXCLUDED.last_activity_at),
    EXCLUDED.last_activity_at
  ),
  updated_at = NOW();

UPDATE payment_orders payment_order
SET contact_id = contact.id,
    updated_at = NOW()
FROM contacts contact
WHERE payment_order.user_id = contact.created_by
  AND LOWER(TRIM(payment_order.customer_email)) = LOWER(contact.email)
  AND payment_order.status IN ('paid', 'partially_refunded', 'refunded')
  AND payment_order.contact_id IS DISTINCT FROM contact.id;

UPDATE payment_subscriptions subscription
SET contact_id = payment_order.contact_id,
    updated_at = NOW()
FROM payment_orders payment_order
WHERE payment_order.contact_id IS NOT NULL
  AND subscription.user_id = payment_order.user_id
  AND (
    subscription.initial_order_id = payment_order.id
    OR (
      payment_order.source_type = 'subscription'
      AND subscription.id = payment_order.source_id
    )
  )
  AND subscription.contact_id IS DISTINCT FROM payment_order.contact_id;

UPDATE deals deal
SET contact_id = payment_order.contact_id,
    updated_at = NOW()
FROM payment_orders payment_order
WHERE deal.user_id = payment_order.user_id
  AND deal.order_id = payment_order.id
  AND deal.contact_id IS NULL
  AND payment_order.contact_id IS NOT NULL;

INSERT INTO contact_list_members (
  list_id, contact_id, source_type, source_id, added_at
)
SELECT mapping.list_id, payment_order.contact_id, 'payment', payment_order.id,
  NOW()
FROM payment_orders payment_order
JOIN checkout_attempts attempt ON attempt.order_id = payment_order.id
JOIN form_submissions submission ON submission.id = attempt.submission_id
JOIN form_list_mappings mapping ON mapping.form_id = submission.form_id
JOIN contact_lists list
  ON list.id = mapping.list_id
 AND list.user_id = payment_order.user_id
WHERE payment_order.contact_id IS NOT NULL
  AND payment_order.status IN ('paid', 'partially_refunded', 'refunded')
ON CONFLICT (list_id, contact_id) DO NOTHING;

INSERT INTO contact_activity (
  id, contact_id, user_id, activity_type, title, detail, entity_type,
  entity_id, metadata, created_at
)
SELECT payment_order.id, payment_order.contact_id, payment_order.user_id,
  'payment_confirmed', 'Payment confirmed',
  CONCAT(
    payment_order.order_number,
    ' · ',
    payment_order.currency,
    ' ',
    payment_order.total_amount
  ),
  'payment_order', payment_order.id,
  jsonb_build_object(
    'amount', payment_order.total_amount,
    'currency', payment_order.currency,
    'orderId', payment_order.id,
    'orderNumber', payment_order.order_number,
    'provider', payment_order.provider,
    'sourceType', payment_order.source_type
  ),
  COALESCE(payment_order.paid_at, payment_order.created_at)
FROM payment_orders payment_order
WHERE payment_order.contact_id IS NOT NULL
  AND payment_order.status IN ('paid', 'partially_refunded', 'refunded')
ON CONFLICT (id) DO NOTHING;

INSERT INTO contact_activity (
  id, contact_id, user_id, activity_type, title, detail, entity_type,
  entity_id, metadata, created_at
)
SELECT refund.id, payment_order.contact_id, refund.user_id, 'payment_refund',
  CASE refund.status
    WHEN 'failed' THEN 'Payment refund failed'
    WHEN 'succeeded' THEN 'Payment refunded'
    ELSE 'Payment refund requested'
  END,
  CONCAT(
    payment_order.order_number,
    ' · ',
    refund.currency,
    ' ',
    refund.amount,
    CASE
      WHEN TRIM(refund.reason) = '' THEN ''
      ELSE ' · ' || refund.reason
    END
  ),
  'payment_refund', refund.id,
  jsonb_build_object(
    'amount', refund.amount,
    'currency', refund.currency,
    'orderId', refund.order_id,
    'provider', refund.provider,
    'refundId', refund.id,
    'status', refund.status
  ),
  refund.requested_at
FROM payment_refunds refund
JOIN payment_orders payment_order ON payment_order.id = refund.order_id
WHERE payment_order.contact_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

UPDATE contacts contact
SET last_activity_at = latest_refund.created_at,
    updated_at = NOW()
FROM (
  SELECT payment_order.contact_id, MAX(refund.requested_at) AS created_at
  FROM payment_refunds refund
  JOIN payment_orders payment_order ON payment_order.id = refund.order_id
  WHERE payment_order.contact_id IS NOT NULL
  GROUP BY payment_order.contact_id
) latest_refund
WHERE contact.id = latest_refund.contact_id
  AND latest_refund.created_at > contact.last_activity_at;

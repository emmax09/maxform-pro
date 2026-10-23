import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

import { getCrmContact360, listCrmTimeline } from "../server/crm-data";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) {
  throw new Error("CRM cross-module smoke test requires DATABASE_URL.");
}

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "");
const email = `crm-cross-module-${suffix}@example.test`;
let userId = "";
let contactId = "";
let formId = "";
let submissionId = "";
let eventId = "";
let campaignId = "";
let listId = "";
let storageObjectId = "";

const cleanup = async () => {
  if (!userId) return;

  // Delete restrictive parents explicitly before removing the temporary user.
  await sql.query(`DELETE FROM contact_campaigns WHERE user_id = $1`, [userId]);
  if (listId) {
    await sql.query(`DELETE FROM contact_list_members WHERE list_id = $1`, [listId]);
    await sql.query(`DELETE FROM contact_lists WHERE id = $1`, [listId]);
  }
  if (eventId) await sql.query(`DELETE FROM events WHERE id = $1`, [eventId]);
  if (submissionId) {
    await sql.query(`DELETE FROM form_submissions WHERE id = $1`, [submissionId]);
  }
  if (formId) await sql.query(`DELETE FROM forms WHERE id = $1`, [formId]);
  await sql.query(`DELETE FROM payment_orders WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM appointments WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM workspace_documents WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM workspace_files WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM storage_objects WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM contacts WHERE created_by = $1`, [userId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
};

try {
  const userRows = await sql.query(
    `INSERT INTO users (email, password_hash, full_name, short_id)
     VALUES ($1, 'non-login-smoke-account', 'CRM Cross Module Smoke', $2)
     RETURNING id`,
    [email, suffix.slice(0, 6).toUpperCase()],
  );
  userId = String(userRows[0].id);

  const contactRows = await sql.query(
    `INSERT INTO contacts (
       email, full_name, company, tags, custom_fields, created_by,
       lifecycle_stage, source_type, last_activity_at
     )
     VALUES ($1, 'CRM Cross Module Contact', 'Integration Workspace', '[]', '{}',
       $2, 'customer', 'integration-smoke', NOW())
     RETURNING id`,
    [email, userId],
  );
  contactId = String(contactRows[0].id);

  const formRows = await sql.query(
    `INSERT INTO forms (title, slug, description, fields, settings, status, created_by)
     VALUES ('CRM Cross Module Form', $1, 'Integration smoke form', '[]', '{}', 'published', $2)
     RETURNING id`,
    [`crm-cross-module-${suffix}`, userId],
  );
  formId = String(formRows[0].id);
  const submissionRows = await sql.query(
    `INSERT INTO form_submissions (form_id, data, submitted_by)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [formId, JSON.stringify({ email, name: "CRM Cross Module Contact" }), userId],
  );
  submissionId = String(submissionRows[0].id);
  await sql.query(
    `INSERT INTO contact_activity (
       contact_id, user_id, activity_type, title, detail,
       entity_type, entity_id, metadata
     )
     VALUES ($1, $2, 'form_submitted', 'Cross-module form submitted',
       'Forms projection', 'submission', $3, '{"sourceModule":"forms"}')`,
    [contactId, userId, submissionId],
  );

  const eventRows = await sql.query(
    `INSERT INTO events (
       created_by, title, slug, description, status, location_type,
       timezone, settings
     )
     VALUES ($1, 'CRM Cross Module Event', $2, 'Integration smoke event',
       'published', 'online', 'UTC', '{}')
     RETURNING id`,
    [userId, `crm-cross-module-${suffix}`],
  );
  eventId = String(eventRows[0].id);
  const ticketRows = await sql.query(
    `INSERT INTO event_ticket_types (
       event_id, name, description, price, currency, quantity_available,
       min_per_order, max_per_order
     )
     VALUES ($1, 'Integration ticket', 'Smoke ticket', 25, 'USD', 20, 1, 4)
     RETURNING id`,
    [eventId],
  );
  await sql.query(
    `INSERT INTO event_attendees (
       event_id, ticket_type_id, registration_submission_id, full_name,
       email, ticket_number, ticket_code, answers
     )
     VALUES ($1, $2, $3, 'CRM Cross Module Contact', $4, $5, $6, '{}')`,
    [
      eventId,
      String(ticketRows[0].id),
      submissionId,
      email,
      `TKT-${suffix.slice(0, 16).toUpperCase()}`,
      `CROSS-${suffix.slice(0, 16).toUpperCase()}`,
    ],
  );

  const startsAt = new Date(Date.now() + 86_400_000).toISOString();
  const endsAt = new Date(Date.now() + 90_000_000).toISOString();
  await sql.query(
    `INSERT INTO appointments (
       user_id, contact_id, invitee_name, invitee_email, starts_at, ends_at,
       status, location_type, meeting_url, currency
     )
     VALUES ($1, $2, 'CRM Cross Module Contact', $3, $4, $5,
       'confirmed', 'video', 'https://meet.example.test/cross-module', 'USD')`,
    [userId, contactId, email, startsAt, endsAt],
  );

  await sql.query(
    `INSERT INTO payment_orders (
       user_id, order_number, source_type, contact_id, customer_name,
       customer_email, status, provider, subtotal, total_amount, currency,
       paid_at
     )
     VALUES ($1, $2, 'manual', $3, 'CRM Cross Module Contact', $4,
       'paid', 'paystack', 125, 125, 'USD', NOW())`,
    [userId, `CROSS-${suffix.slice(0, 12).toUpperCase()}`, contactId, email],
  );

  await sql.query(
    `INSERT INTO workspace_documents (
       user_id, contact_id, title, status, merge_values
     )
     VALUES ($1, $2, 'CRM Cross Module Agreement', 'sent', '{}')`,
    [userId, contactId],
  );

  const storageRows = await sql.query(
    `INSERT INTO storage_objects (
       user_id, bucket_name, object_key, file_name, mime_type, size_bytes,
       purpose, status, scan_status, verified_at
     )
     VALUES ($1, 'maxform-smoke', $2, 'cross-module.txt', 'text/plain',
       12, 'workspace_file', 'ready', 'validated', NOW())
     RETURNING id`,
    [userId, `tenants/${userId}/crm-cross-module/${suffix}/cross-module.txt`],
  );
  storageObjectId = String(storageRows[0].id);
  const fileRows = await sql.query(
    `INSERT INTO workspace_files (
       user_id, name, mime_type, size_bytes, storage_key,
       storage_object_id, storage_provider, source_type, source_id,
       source_label, uploaded_by, scan_status
     )
     VALUES ($1, 'cross-module.txt', 'text/plain', 12, $2, $3, 'r2',
       'form_upload', $4, 'CRM Cross Module Form upload', $1, 'validated')
     RETURNING id`,
    [
      userId,
      `tenants/${userId}/crm-cross-module/${suffix}/cross-module.txt`,
      storageObjectId,
      submissionId,
    ],
  );
  await sql.query(
    `INSERT INTO contact_activity (
       contact_id, user_id, activity_type, title, detail,
       entity_type, entity_id, metadata
     )
     VALUES ($1, $2, 'file_uploaded', 'Cross-module file uploaded',
       'Files projection', 'file', $3, '{"sourceModule":"files"}')`,
    [contactId, userId, String(fileRows[0].id)],
  );

  const listRows = await sql.query(
    `INSERT INTO contact_lists (
       user_id, name, description, list_type, filter_definition, created_by
     )
     VALUES ($1, 'CRM Cross Module List', 'Integration smoke audience',
       'static', '[]', $1)
     RETURNING id`,
    [userId],
  );
  listId = String(listRows[0].id);
  await sql.query(
    `INSERT INTO contact_list_members (list_id, contact_id, source_type)
     VALUES ($1, $2, 'integration-smoke')`,
    [listId, contactId],
  );
  const campaignRows = await sql.query(
    `INSERT INTO contact_campaigns (
       user_id, name, list_id, subject, preview_text, html_body, status,
       sent_at
     )
     VALUES ($1, 'CRM Cross Module Campaign', $2, 'Integration smoke',
       'Cross-module timeline check', '<p>Smoke</p>', 'sent', NOW())
     RETURNING id`,
    [userId, listId],
  );
  campaignId = String(campaignRows[0].id);
  await sql.query(
    `INSERT INTO contact_campaign_messages (
       campaign_id, contact_id, recipient, status, sent_at
     )
     VALUES ($1, $2, $3, 'sent', NOW())`,
    [campaignId, contactId, email],
  );

  await sql.query(
    `INSERT INTO crm_activities (
       user_id, activity_type, title, detail, contact_id, actor_user_id,
       metadata
     )
     VALUES ($1, 'integration_smoke', 'Cross-module CRM activity',
       'CRM projection check', $2, $1, '{"smoke":true}')`,
    [userId, contactId],
  );

  const detail = await getCrmContact360(userId, contactId);
  const timeline = await listCrmTimeline(userId, { contactId, limit: 100 });
  const expectedSources = [
    "forms",
    "events",
    "appointments",
    "payments",
    "documents",
    "files",
    "campaigns",
    "crm",
  ];
  const timelineSources = new Set(timeline.map((event) => event.sourceModule));
  const missingSources = expectedSources.filter((source) => !timelineSources.has(source));
  if (missingSources.length) {
    throw new Error(
      `CRM cross-module timeline is missing: ${missingSources.join(", ")}.`,
    );
  }
  if (
    !detail.forms.length ||
    !detail.events.length ||
    !detail.appointments.length ||
    !detail.documents.length ||
    !detail.files.length ||
    !detail.payments.length ||
    !detail.campaigns.length
  ) {
    throw new Error("Customer 360 did not return every linked source record.");
  }

  process.stdout.write(
    `CRM cross-module smoke passed (${expectedSources.length} sources, ${timeline.length} timeline events, ${detail.forms.length + detail.events.length + detail.appointments.length + detail.documents.length + detail.files.length + detail.payments.length + detail.campaigns.length} linked records).
`,
  );
} finally {
  await cleanup();
}

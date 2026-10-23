import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

import {
  getCrmContact360,
  getCrmWorkspace,
  listCrmTimeline,
  searchCrm,
} from "../server/crm-data";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("Customer 360 smoke test requires DATABASE_URL.");

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "");
const email = `crm-360-smoke-${suffix}@example.test`;
let userId = "";

try {
  const userRows = await sql.query(
    `INSERT INTO users (email, password_hash, full_name, short_id)
     VALUES ($1, 'non-login-smoke-account', 'Customer 360 Smoke', $2)
     RETURNING id`,
    [email, suffix.slice(0, 6).toUpperCase()],
  );
  userId = String(userRows[0].id);
  const contactRows = await sql.query(
    `INSERT INTO contacts (
       email, full_name, company, tags, custom_fields, created_by,
       lifecycle_stage, source_type, last_activity_at
     )
     VALUES ($1, 'Customer 360 Smoke Contact', 'Smoke Workspace', '[]', '{}',
       $2, 'lead', 'manual', NOW())
     RETURNING id`,
    [email, userId],
  );
  const contactId = String(contactRows[0].id);
  const relatedRows = await sql.query(
    `INSERT INTO contacts (
       email, full_name, company, tags, custom_fields, created_by,
       lifecycle_stage, source_type, last_activity_at
     )
     VALUES ($1, 'Customer 360 Smoke Related', 'Smoke Workspace', '[]', '{}',
       $2, 'lead', 'manual', NOW())
     RETURNING id`,
    [`related-${suffix}@example.test`, userId],
  );
  const relatedContactId = String(relatedRows[0].id);
  await sql.query(
    `INSERT INTO crm_contact_relationships (
       user_id, contact_id, related_contact_id, relationship_type, notes
     )
     VALUES ($1, $2, $3, 'decision_maker', 'Customer 360 smoke relationship')`,
    [userId, contactId, relatedContactId],
  );
  await sql.query(
    `INSERT INTO crm_activities (
       user_id, activity_type, title, detail, contact_id, actor_user_id,
       metadata
     )
     VALUES ($1, 'smoke_activity', 'Customer 360 smoke activity',
       'Universal timeline projection check', $2, $1, '{"smoke":true}')`,
    [userId, contactId],
  );

  const workspace = await getCrmWorkspace(userId);
  const detail = await getCrmContact360(userId, contactId);
  const timeline = await listCrmTimeline(userId, { contactId, limit: 25 });
  const search = await searchCrm(userId, "Customer 360 Smoke", 10);

  if (!workspace.contacts.some((contact) => contact.id === contactId)) {
    throw new Error("Customer 360 smoke could not see the scoped contact.");
  }
  if (!detail.timeline.some((event) => event.title === "Customer 360 smoke activity")) {
    throw new Error("Customer 360 smoke could not see the projected activity.");
  }
  if (!detail.relationships.some((relationship) => relationship.contactId === relatedContactId)) {
    throw new Error("Customer 360 smoke could not see the relationship graph edge.");
  }
  if (workspace.commandCenter?.metrics.trackedRelationships !== 2) {
    throw new Error("CRM command center did not count tracked relationships.");
  }
  if (!timeline.some((event) => event.contactId === contactId)) {
    throw new Error("Universal timeline filter did not return the contact event.");
  }
  if (!search.some((result) => result.id === contactId && result.resultType === "contact")) {
    throw new Error("CRM search did not return the scoped contact.");
  }
  process.stdout.write(
    `Customer 360 smoke passed (${workspace.contacts.length} contacts, ${detail.timeline.length} timeline events, ${search.length} search results, command center ready).\n`,
  );
} finally {
  if (userId) {
    await sql.query(`DELETE FROM contacts WHERE created_by = $1`, [userId]);
    await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }
}
